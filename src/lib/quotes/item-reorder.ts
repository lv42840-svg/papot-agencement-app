import type { QuoteItem, QuoteLine, QuoteSection, QuoteSubsection } from "./model";

export type QuoteItemPlacement = "BEFORE" | "AFTER" | "INSIDE";

function sectionBlockEnd(elements: QuoteItem[], startIndex: number): number {
  for (let indice = startIndex + 1; indice < elements.length; indice += 1) {
    if (elements[indice].kind === "SECTION") return indice;
  }
  return elements.length;
}

function subsectionBlockEnd(elements: QuoteItem[], startIndex: number): number {
  const subsection = elements[startIndex];
  if (!subsection || subsection.kind !== "SUBSECTION") return startIndex + 1;

  let indice = startIndex + 1;
  while (indice < elements.length) {
    const candidat = elements[indice];
    if (
      (candidat.kind === "LINE" || candidat.kind === "COMMENT") &&
      candidat.parentId === subsection.id
    ) {
      indice += 1;
      continue;
    }
    break;
  }
  return indice;
}

function sourceBlockEnd(elements: QuoteItem[], startIndex: number): number {
  const element = elements[startIndex];
  if (!element) return startIndex + 1;
  if (element.kind === "SECTION") return sectionBlockEnd(elements, startIndex);
  if (element.kind === "SUBSECTION") return subsectionBlockEnd(elements, startIndex);
  return startIndex + 1;
}

function isDraggableItem(
  element: QuoteItem,
): element is QuoteLine | QuoteSection | QuoteSubsection {
  return element.kind === "LINE" || element.kind === "SECTION" || element.kind === "SUBSECTION";
}

function reparentSourceBlock(
  block: QuoteItem[],
  source: QuoteLine | QuoteSection | QuoteSubsection,
  parentId: string | null | undefined,
): QuoteItem[] {
  if (parentId === undefined || source.kind === "SECTION") return block;

  return block.map((element, indice) => {
    if (indice !== 0) return element;
    if (element.kind === "SUBSECTION") {
      if (parentId === null) throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      return { ...element, parentId };
    }
    if (element.kind === "LINE") return { ...element, parentId };
    return element;
  });
}

function findTargetIndex(elements: QuoteItem[], targetId: string): number {
  const targetIndex = elements.findIndex((element) => element.id === targetId);
  if (targetIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");
  return targetIndex;
}

export function reorderQuoteItems(
  sourceItems: QuoteItem[],
  idElement: string,
  targetId: string,
  placement: QuoteItemPlacement,
): QuoteItem[] {
  if (idElement === targetId) throw new Error("QUOTE_ITEM_REORDER_BLOCKED");

  const sourceIndex = sourceItems.findIndex((element) => element.id === idElement);
  const targetIndex = sourceItems.findIndex((element) => element.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");

  const source = sourceItems[sourceIndex];
  const cible = sourceItems[targetIndex];
  if (!isDraggableItem(source)) throw new Error("QUOTE_ITEM_REORDER_BLOCKED");

  const sourceEnd = sourceBlockEnd(sourceItems, sourceIndex);
  if (targetIndex >= sourceIndex && targetIndex < sourceEnd) {
    throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
  }

  let nextParentId: string | null | undefined;

  if (source.kind === "SECTION") {
    if (cible.kind !== "SECTION" || placement === "INSIDE") {
      throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
    }
  } else if (source.kind === "SUBSECTION") {
    if (cible.kind === "SECTION") {
      if (placement !== "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = cible.id;
    } else if (cible.kind === "SUBSECTION") {
      if (placement === "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = cible.parentId;
    } else {
      throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
    }
  } else {
    if (cible.kind === "SECTION" || cible.kind === "SUBSECTION") {
      if (placement !== "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = cible.id;
    } else if (cible.kind === "LINE") {
      if (placement === "INSIDE") throw new Error("QUOTE_ITEM_REORDER_BLOCKED");
      nextParentId = cible.parentId;
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
