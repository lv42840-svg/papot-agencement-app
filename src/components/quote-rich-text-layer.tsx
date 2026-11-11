"use client";

import { useEffect, useMemo } from "react";
import type { QuoteItem, QuoteRichText } from "@/lib/quotes/model";
import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";
import { resolveQuoteRichText } from "@/lib/quotes/rich-text";
import type { NativeQuoteRecord } from "@/lib/quotes/store";

type Props = {
  quote: NativeQuoteRecord | null;
};

function itemText(element: QuoteItem): string | null {
  if (element.kind === "SECTION" || element.kind === "SUBSECTION") return element.title;
  if (element.kind === "LINE") return element.description;
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

function paintRichText(cible: HTMLElement, element: QuoteItem) {
  const texte = itemText(element);
  if (texte === null) return;
  const richText = resolveQuoteRichText(
    texte,
    element.presentation?.richText,
    element.presentation?.textStyle,
  );
  Object.assign(cible.style, {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    overflow: "visible",
    textOverflow: "clip",
  });
  cible.replaceChildren();
  for (const run of richText.runs) {
    const span = cible.ownerDocument.createElement("span");
    Object.assign(span.style, styleForRun(run));
    span.textContent = run.text;
    cible.append(span);
  }
}

function resolveItemFromTarget(
  cible: HTMLElement,
  quote: NativeQuoteRecord,
  itemByNumber: ReadonlyMap<string, QuoteItem>,
): QuoteItem | null {
  const ligneTableau = cible.closest<HTMLElement>(".quoteMainRow");
  const number = ligneTableau?.querySelector<HTMLElement>(".quoteNumber")?.textContent?.trim();
  if (!number) return null;
  const element = itemByNumber.get(number);
  if (!element || !quote.model.items.some((candidat) => candidat.id === element.id)) return null;
  return element;
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
    for (const element of quote.model.items) {
      const texte = itemText(element);
      const number = numbers.get(element.id);
      if (texte !== null && number) map.set(number, element);
    }
    return map;
  }, [quote]);

  useEffect(() => {
    if (!quote) return;

    const decorate = () => {
      const targets = document.querySelectorAll<HTMLElement>(
        ".quoteHeadingTitle, .quoteLineDescription > strong",
      );
      for (const cible of targets) {
        const element = resolveItemFromTarget(cible, quote, itemByNumber);
        if (element) paintRichText(cible, element);
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
