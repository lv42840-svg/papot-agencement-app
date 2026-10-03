import type { QuoteItem, QuoteLine, QuoteSection, QuoteSubsection } from "./model";

export type QuoteItemPlacement = "BEFORE" | "AFTER" | "INSIDE";

function sectionBlockEnd(items: QuoteItem[], startIndex: number): number {
  for (let index = startIndex + 1; index < items.length; index += 1) {
    if (items[index].kind === "SECTION") return index;
  }
  return items.length;
}

function subsectionBlockEnd(items: QuoteItem[], startIndex: number): number {
  const subsection = items[startIndex];
  if (!subsection || subsection.kind !== "SUBSECTION") return startIndex + 1;

  let index = startIndex + 1;
  while (index < items.length) {
    const candidate = items[index];
    if (
      (candidate.kind === "LINE" || candidate.kind === "COMMENT") &&
      candidate.parentId === subsection.id
    ) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function sourceBlockEnd(items: QuoteItem[], startIndex: number): number {
  const item = items[startIndex];
  if (!item) return startIndex + 1;
  if (item.kind === "SECTION") return sectionBlockEnd(items, startIndex);
  if (item.kind === "SUBSECTION") return subsectionBlockEnd(items, startIndex);
  return startIndex + 1;
}

function isDraggableItem(item: QuoteItem): item is QuoteLine | QuoteSection | QuoteSubsection {
  return item.kind === "LINE" || item.kind === "SECTION" || item.kind === "SUBSECTION";
}

function reparentSourceBlock(
  block: QuoteItem[],
  source: QuoteLine | QuoteSection | QuoteSubsection,
  parentId: string | null | undefined,
): QuoteItem[] {
  if (parentId === undefined || source.kind === "SECTION") return block;

  return block.map((item, index) => {
    if (index !== 0) return item;
    if (item.kind === "SUBSECTION") {
      if (parentId === null) throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      return { ...item, parentId };
    }
    if (item.kind === "LINE") return { ...item, parentId };
    return item;
  });
}

function findTargetIndex(items: QuoteItem[], targetId: string): number {
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");
  return targetIndex;
}

export function reorderQuoteItems(
  sourceItems: QuoteItem[],
  itemId: string,
  targetId: string,
  placement: QuoteItemPlacement,
): QuoteItem[] {
  if (itemId === targetId) throw new Error("QUOTE_ITEM_REORDER_BLOCKED");

  const sourceIndex = sourceItems.findIndex((item) => item.id === itemId);
  const targetIndex = sourceItems.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");

  const source = sourceItems[sourceIndex];
  const target = sourceItems[targetIndex];
  if (!isDraggableItem(source)) throw new Error("QUOTE_ITEM_REORDER_BLOCKED");

  const sourceEnd = sourceBlockEnd(sourceItems, sourceIndex);
  if (targetIndex >= sourceIndex && targetIndex < sourceEnd) {
    throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
  }

  let nextParentId: string | null | undefined;

  if (source.kind === "SECTION") {
    if (target.kind !== "SECTION" || placement === "INSIDE") {
      throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
    }
  } else if (source.kind === "SUBSECTION") {
    if (target.kind === "SECTION") {
      if (placement !== "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = target.id;
    } else if (target.kind === "SUBSECTION") {
      if (placement === "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = target.parentId;
    } else {
      throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
    }
  } else {
    if (target.kind === "SECTION" || target.kind === "SUBSECTION") {
      if (placement !== "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = target.id;
    } else if (target.kind === "LINE") {
      if (placement === "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = target.parentId;
    } else {
      throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
    }
  }

  const sourceBlock = sourceItems.slice(sourceIndex, sourceEnd);
  const remaining = [...sourceItems.slice(0, sourceIndex), ...sourceItems.slice(sourceEnd)];
  const remainingTargetIndex = findTargetIndex(remaining, targetId);
  const remainingTarget = remaining[remainingTargetIndex];

  let insertionIndex: number;
  if (source.kind === "SECTION") {
    insertionIndex =
      placement === "BEFORE"
        ? remainingTargetIndex
        : sectionBlockEnd(remaining, remainingTargetIndex);
  } else if (source.kind === "SUBSECTION") {
    if (remainingTarget.kind === "SECTION") {
      insertionIndex = sectionBlockEnd(remaining, remainingTargetIndex);
    } else if (remainingTarget.kind === "SUBSECTION") {
      insertionIndex =
        placement === "BEFORE"
          ? remainingTargetIndex
          : subsectionBlockEnd(remaining, remainingTargetIndex);
    } else {
      throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
    }
  } else if (remainingTarget.kind === "SECTION") {
    insertionIndex = sectionBlockEnd(remaining, remainingTargetIndex);
  } else if (remainingTarget.kind === "SUBSECTION") {
    insertionIndex = subsectionBlockEnd(remaining, remainingTargetIndex);
  } else if (remainingTarget.kind === "LINE") {
    insertionIndex = placement === "BEFORE" ? remainingTargetIndex : remainingTargetIndex + 1;
  } else {
    throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
  }

  const block = reparentSourceBlock(sourceBlock, source, nextParentId);
  return [...remaining.slice(0, insertionIndex), ...block, ...remaining.slice(insertionIndex)];
}
