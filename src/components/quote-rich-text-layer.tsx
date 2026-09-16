"use client";

import { useEffect, useMemo } from "react";
import type { QuoteItem, QuoteRichText } from "@/lib/quotes/model";
import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";
import { resolveQuoteRichText } from "@/lib/quotes/rich-text";
import type { NativeQuoteRecord } from "@/lib/quotes/store";

type Props = {
  quote: NativeQuoteRecord | null;
};

function itemText(item: QuoteItem): string | null {
  if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.title;
  if (item.kind === "LINE") return item.description;
  return null;
}

function styleForRun(run: QuoteRichText["runs"][number]): Partial<CSSStyleDeclaration> {
  return {
    fontWeight: run.style.bold ? "800" : "400",
    fontStyle: run.style.italic ? "italic" : "normal",
    textDecoration: run.style.underline ? "underline" : "none",
    color: run.style.textColor ?? "",
    backgroundColor: run.style.highlightColor ?? "",
    fontSize: run.style.fontSizePx ? `${run.style.fontSizePx}px` : "",
  };
}

function paintRichText(target: HTMLElement, item: QuoteItem) {
  const text = itemText(item);
  if (text === null) return;
  const richText = resolveQuoteRichText(
    text,
    item.presentation?.richText,
    item.presentation?.textStyle,
  );
  target.replaceChildren();
  for (const run of richText.runs) {
    const span = target.ownerDocument.createElement("span");
    Object.assign(span.style, styleForRun(run));
    span.textContent = run.text;
    target.append(span);
  }
}

function resolveItemFromTarget(
  target: HTMLElement,
  quote: NativeQuoteRecord,
  itemByNumber: ReadonlyMap<string, QuoteItem>,
): QuoteItem | null {
  const row = target.closest<HTMLElement>(".quoteMainRow");
  const number = row?.querySelector<HTMLElement>(".quoteNumber")?.textContent?.trim();
  if (!number) return null;
  const item = itemByNumber.get(number);
  if (!item || !quote.model.items.some((candidate) => candidate.id === item.id)) return null;
  return item;
}

function mutationAddsQuoteRows(mutation: MutationRecord): boolean {
  return Array.from(mutation.addedNodes).some((node) => {
    if (!(node instanceof HTMLElement)) return false;
    return node.matches(".quoteMainRow") || node.querySelector(".quoteMainRow") !== null;
  });
}

export function QuoteRichTextLayer({ quote }: Props) {
  const itemByNumber = useMemo(() => {
    const map = new Map<string, QuoteItem>();
    if (!quote) return map;
    const numbers = buildQuoteItemNumbers(quote.model.items);
    for (const item of quote.model.items) {
      const text = itemText(item);
      const number = numbers.get(item.id);
      if (text !== null && number) map.set(number, item);
    }
    return map;
  }, [quote]);

  useEffect(() => {
    if (!quote) return;

    const decorate = () => {
      const targets = document.querySelectorAll<HTMLElement>(
        ".quoteHeadingRow > strong, .quoteLineDescription > strong",
      );
      for (const target of targets) {
        const item = resolveItemFromTarget(target, quote, itemByNumber);
        if (item) paintRichText(target, item);
      }
    };

    decorate();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(mutationAddsQuoteRows)) requestAnimationFrame(decorate);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [itemByNumber, quote]);

  return null;
}
