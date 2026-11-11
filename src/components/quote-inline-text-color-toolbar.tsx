"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  applyQuoteInlineTextColor,
  QUOTE_INLINE_TEXT_COLOR_PRESETS,
} from "@/lib/quotes/inline-text-color";
import type { QuoteItem, QuoteItemTextStyle } from "@/lib/quotes/model";
import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";
import { defaultQuoteItemTextStyle } from "@/lib/quotes/presentation";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type SupportedItem = Extract<QuoteItem, { kind: "SECTION" | "SUBSECTION" | "LINE" }>;

type SelectionState = {
  itemId: string;
  start: number;
  end: number;
  left: number;
  top: number;
};

type HighlightRegistryLike = {
  set(nom: string, highlight: unknown): void;
  delete(nom: string): boolean;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

const HIGHLIGHT_PREFIX = "quote-inline-color-";
const TEXT_ROOT_SELECTOR = ".quoteLineDescription > strong, .quoteHeadingRow > strong";

function itemText(item: SupportedItem): string {
  return item.kind === "LINE" ? item.description : item.title;
}

function textRootFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const root = element?.closest(TEXT_ROOT_SELECTOR);
  return root instanceof HTMLElement ? root : null;
}

function textOffset(root: HTMLElement, node: Node, offset: number): number | null {
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function domRangeForOffsets(root: HTMLElement, debut: number, fin: number): Range | null {
  if (fin <= debut) return null;
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  let cursor = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;
  let courant = walker.nextNode();

  while (courant) {
    const length = courant.textContent?.length ?? 0;
    const nextCursor = cursor + length;

    if (!startNode && debut >= cursor && debut <= nextCursor) {
      startNode = courant;
      startOffset = Math.min(debut - cursor, length);
    }
    if (!endNode && fin >= cursor && fin <= nextCursor) {
      endNode = courant;
      endOffset = Math.min(fin - cursor, length);
      break;
    }

    cursor = nextCursor;
    courant = walker.nextNode();
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function highlightName(color: string): string {
  return `${HIGHLIGHT_PREFIX}${color.slice(1).toLowerCase()}`;
}

function highlightRegistry(): {
  registry: HighlightRegistryLike;
  HighlightClass: HighlightConstructor;
} | null {
  if (typeof window === "undefined" || typeof CSS === "undefined") return null;
  const css = CSS as typeof CSS & { highlights?: HighlightRegistryLike };
  const HighlightClass = (window as typeof window & { Highlight?: HighlightConstructor }).Highlight;
  if (!css.highlights || !HighlightClass) return null;
  return { registry: css.highlights, HighlightClass };
}

function clearQuoteHighlights(registry: HighlightRegistryLike) {
  for (const preset of QUOTE_INLINE_TEXT_COLOR_PRESETS) {
    registry.delete(highlightName(preset.value));
  }
}

export function QuoteInlineTextColorToolbar({
  quote,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  onSaved: (contenu: NativeQuotesPayload) => void;
}) {
  const [selectionCourante, setSelection] = useState<SelectionState | null>(null);
  const [sauvegardeEnCours, setSaving] = useState(false);
  const [erreur, setError] = useState<string | null>(null);

  const numbers = useMemo(() => buildQuoteItemNumbers(quote.model.items), [quote.model.items]);
  const itemByNumber = useMemo(() => {
    const resultat = new Map<string, SupportedItem>();
    for (const item of quote.model.items) {
      if (item.kind !== "SECTION" && item.kind !== "SUBSECTION" && item.kind !== "LINE") continue;
      const number = numbers.get(item.id);
      if (number) resultat.set(number, item);
    }
    return resultat;
  }, [numbers, quote.model.items]);

  function resolveItem(root: HTMLElement): SupportedItem | null {
    const ligneTableau = root.closest(".quoteMainRow");
    const number = ligneTableau?.querySelector(".quoteNumber")?.textContent?.trim();
    if (!number) return null;
    const item = itemByNumber.get(number) ?? null;
    if (!item) return null;
    return root.textContent === itemText(item) ? item : null;
  }

  useEffect(() => {
    const support = highlightRegistry();
    if (!support) return;
    clearQuoteHighlights(support.registry);

    const rangesByColor = new Map<string, Range[]>();
    const lignesTableau = Array.from(
      document.querySelectorAll<HTMLElement>(".quoteLinesTable .quoteMainRow"),
    );

    for (const ligneTableau of lignesTableau) {
      const number = ligneTableau.querySelector(".quoteNumber")?.textContent?.trim();
      if (!number) continue;
      const item = itemByNumber.get(number);
      if (!item) continue;
      const root = ligneTableau.querySelector<HTMLElement>(
        item.kind === "LINE" ? ".quoteLineDescription > strong" : ".quoteHeadingRow > strong",
      );
      if (!root || root.textContent !== itemText(item)) continue;

      for (const mark of item.presentation?.textStyle?.textColorMarks ?? []) {
        const range = domRangeForOffsets(root, mark.start, mark.end);
        if (!range) continue;
        const courant = rangesByColor.get(mark.color) ?? [];
        courant.push(range);
        rangesByColor.set(mark.color, courant);
      }
    }

    for (const [color, ranges] of rangesByColor) {
      support.registry.set(highlightName(color), new support.HighlightClass(...ranges));
    }

    return () => clearQuoteHighlights(support.registry);
  }, [itemByNumber, quote.model.items]);

  useEffect(() => {
    if (!canWrite) return;

    function handleMouseUp(evenement: MouseEvent) {
      const cible = evenement.target;
      if (cible instanceof Element && cible.closest(".quoteInlineTextToolbar")) return;

      const browserSelection = window.getSelection();
      if (!browserSelection || browserSelection.rangeCount === 0 || browserSelection.isCollapsed) {
        setSelection(null);
        return;
      }

      const range = browserSelection.getRangeAt(0);
      const startRoot = textRootFromNode(range.startContainer);
      const endRoot = textRootFromNode(range.endContainer);
      if (!startRoot || startRoot !== endRoot) {
        setSelection(null);
        return;
      }

      const item = resolveItem(startRoot);
      if (!item) {
        setSelection(null);
        return;
      }

      const debut = textOffset(startRoot, range.startContainer, range.startOffset);
      const fin = textOffset(startRoot, range.endContainer, range.endOffset);
      if (debut === null || fin === null || fin <= debut) {
        setSelection(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      setError(null);
      setSelection({
        itemId: item.id,
        start: debut,
        end: fin,
        left: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
        top: Math.max(8, rect.top - 42),
      });
    }

    function handleDragStart(evenement: DragEvent) {
      const cible = evenement.target;
      if (!(cible instanceof Node)) return;
      if (textRootFromNode(cible)) evenement.preventDefault();
    }

    function handleKeyDown(evenement: KeyboardEvent) {
      if (evenement.key === "Escape") setSelection(null);
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("dragstart", handleDragStart, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("dragstart", handleDragStart, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [canWrite, itemByNumber]);

  async function applyColor(color: string | null) {
    if (!selectionCourante || sauvegardeEnCours) return;
    const item = quote.model.items.find((candidat) => candidat.id === selectionCourante.itemId);
    if (!item || (item.kind !== "SECTION" && item.kind !== "SUBSECTION" && item.kind !== "LINE")) {
      setSelection(null);
      return;
    }

    const texte = itemText(item);
    const currentStyle: QuoteItemTextStyle =
      item.presentation?.textStyle ?? defaultQuoteItemTextStyle(item);
    const nextMarks = applyQuoteInlineTextColor(
      texte.length,
      currentStyle.textColorMarks ?? [],
      selectionCourante.start,
      selectionCourante.end,
      color,
    );
    const nextStyle: QuoteItemTextStyle = {
      ...currentStyle,
      textColorMarks: nextMarks.length > 0 ? nextMarks : undefined,
    };

    setSaving(true);
    setError(null);
    try {
      const reponse = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateItemPresentation",
          quoteId: quote.id,
          itemId: item.id,
          textStyle: nextStyle,
        }),
      });
      const corps = (await reponse.json()) as { payload?: NativeQuotesPayload; error?: string };
      if (!reponse.ok || !corps.payload) throw new Error(corps.error ?? "QUOTES_REQUEST_FAILED");
      onSaved(corps.payload);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch {
      setError("Erreur");
    } finally {
      setSaving(false);
    }
  }

  if (!canWrite || !selectionCourante) return null;

  return (
    <>
      <div
        className="quoteInlineTextToolbar"
        role="toolbar"
        aria-label="Couleur du texte sélectionné"
        style={{ left: selectionCourante.left, top: selectionCourante.top }}
        onMouseDown={(evenement) => evenement.preventDefault()}
      >
        {QUOTE_INLINE_TEXT_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="quoteInlineTextColorButton"
            onClick={() => void applyColor(preset.value)}
            disabled={sauvegardeEnCours}
            aria-label={`Texte ${preset.label.toLowerCase()}`}
            title={preset.label}
          >
            <span style={{ backgroundColor: preset.value }} />
          </button>
        ))}
        <span className="quoteInlineTextDivider" aria-hidden="true" />
        <button
          type="button"
          className="quoteInlineTextResetButton"
          onClick={() => void applyColor(null)}
          disabled={sauvegardeEnCours}
          aria-label="Retirer la couleur de la sélection"
          title="Retirer la couleur"
        >
          <RotateCcw size={13} aria-hidden="true" />
        </button>
        {erreur ? <span className="quoteInlineTextError">{erreur}</span> : null}
      </div>

      <style jsx global>{`
        .quoteLineDescription > strong,
        .quoteHeadingRow > strong {
          user-select: text;
          cursor: text;
        }
        .quoteInlineTextToolbar {
          position: fixed;
          z-index: 250;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 4px;
          min-height: 32px;
          padding: 4px 6px;
          border: 1px solid #d9d6e8;
          border-radius: 9px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(45, 38, 75, 0.2);
        }
        .quoteInlineTextColorButton,
        .quoteInlineTextResetButton {
          width: 24px;
          height: 24px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
        }
        .quoteInlineTextColorButton:hover,
        .quoteInlineTextResetButton:hover {
          background: #f1eff8;
        }
        .quoteInlineTextColorButton:disabled,
        .quoteInlineTextResetButton:disabled {
          cursor: wait;
          opacity: 0.55;
        }
        .quoteInlineTextColorButton > span {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 1px solid rgba(15, 23, 42, 0.18);
        }
        .quoteInlineTextDivider {
          width: 1px;
          height: 18px;
          background: #dedbea;
          margin: 0 1px;
        }
        .quoteInlineTextError {
          color: #a73737;
          font-size: 10px;
          font-weight: 700;
          padding: 0 2px;
        }
        ::highlight(quote-inline-color-111827) {
          color: #111827;
        }
        ::highlight(quote-inline-color-475569) {
          color: #475569;
        }
        ::highlight(quote-inline-color-6554b5) {
          color: #6554b5;
        }
        ::highlight(quote-inline-color-2563eb) {
          color: #2563eb;
        }
        ::highlight(quote-inline-color-15803d) {
          color: #15803d;
        }
        ::highlight(quote-inline-color-b91c1c) {
          color: #b91c1c;
        }
        ::highlight(quote-inline-color-c2410c) {
          color: #c2410c;
        }
      `}</style>
    </>
  );
}
