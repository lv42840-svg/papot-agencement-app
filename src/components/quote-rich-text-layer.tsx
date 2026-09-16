"use client";

import { Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { QuoteRichTextEditor } from "@/components/quote-rich-text-editor";
import type { QuoteItem, QuoteRichText } from "@/lib/quotes/model";
import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";
import {
  quoteRichTextToPlainText,
  resolveQuoteRichText,
} from "@/lib/quotes/rich-text";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type Props = {
  quote: NativeQuoteRecord | null;
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
};

type ActiveEditor = {
  itemId: string;
  richText: QuoteRichText;
  anchor: DOMRect;
};

type SaveResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
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
  const richText = resolveQuoteRichText(text, item.presentation?.richText, item.presentation?.textStyle);
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

export function QuoteRichTextLayer({ quote, canWrite, onSaved }: Props) {
  const [active, setActive] = useState<ActiveEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
        if (!item) continue;
        paintRichText(target, item);
        target.dataset.quoteRichTextTarget = item.id;
        if (canWrite) {
          target.style.cursor = "text";
          target.title = "Cliquer pour éditer le texte et sa mise en forme";
        }
      }
    };

    decorate();
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some(
          (node) => node instanceof HTMLElement && node.closest(".quoteMainRow"),
        ),
      );
      if (relevant) requestAnimationFrame(decorate);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
      if (!canWrite || event.button !== 0) return;
      const element = event.target instanceof Element ? event.target : null;
      const target = element?.closest<HTMLElement>(
        ".quoteHeadingRow > strong, .quoteLineDescription > strong",
      );
      if (!target) return;
      const item = resolveItemFromTarget(target, quote, itemByNumber);
      const text = item ? itemText(item) : null;
      if (!item || text === null) return;
      event.preventDefault();
      event.stopPropagation();
      setError("");
      setActive({
        itemId: item.id,
        richText: resolveQuoteRichText(text, item.presentation?.richText, item.presentation?.textStyle),
        anchor: target.getBoundingClientRect(),
      });
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
    };
  }, [canWrite, itemByNumber, quote]);

  useEffect(() => {
    if (!active) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [active]);

  if (!quote || !active || typeof document === "undefined") return null;

  const item = quote.model.items.find((candidate) => candidate.id === active.itemId);
  if (!item) return null;
  const text = itemText(item);
  if (text === null) return null;
  const isHeading = item.kind === "SECTION" || item.kind === "SUBSECTION";
  const panelWidth = Math.min(Math.max(active.anchor.width + 120, 520), window.innerWidth - 24);
  const left = Math.min(Math.max(12, active.anchor.left), window.innerWidth - panelWidth - 12);
  const estimatedHeight = 150;
  const top =
    active.anchor.bottom + estimatedHeight < window.innerHeight
      ? active.anchor.bottom + 6
      : Math.max(12, active.anchor.top - estimatedHeight - 6);

  async function save() {
    if (!quote || !active) return;
    const plainText = quoteRichTextToPlainText(active.richText).trim();
    if (!plainText) {
      setError("Le texte ne peut pas être vide.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/desktop/quotes/${quote.id}/items/${active.itemId}/rich-text`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: plainText, richText: active.richText }),
        },
      );
      const data = (await response.json()) as SaveResponse;
      if (!response.ok || !data.payload) throw new Error(data.error ?? "QUOTE_RICH_TEXT_SAVE_FAILED");
      onSaved(data.payload);
      setActive(null);
    } catch {
      setError("La mise en forme n’a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="quoteRichLayer"
      role="dialog"
      aria-label={isHeading ? "Édition riche du titre" : "Édition riche de la désignation"}
      style={{ left, top, width: panelWidth }}
    >
      <div className="quoteRichLayerHeader">
        <strong>{isHeading ? "Titre" : "Désignation"}</strong>
        <span>Sélectionnez un mot ou une portion de texte, puis appliquez la mise en forme.</span>
        <div className="quoteRichLayerActions">
          <button type="button" className="secondary" onClick={() => setActive(null)} disabled={saving}>
            <X size={14} aria-hidden="true" />
            Annuler
          </button>
          <button type="button" className="primary" onClick={save} disabled={saving}>
            <Check size={14} aria-hidden="true" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
      <QuoteRichTextEditor
        value={active.richText}
        onChange={(richText) => setActive((current) => (current ? { ...current, richText } : current))}
        ariaLabel={isHeading ? "Texte du titre" : "Texte de la désignation"}
        maxLength={item.kind === "LINE" ? 4000 : 500}
      />
      {error ? <p className="quoteRichLayerError">{error}</p> : null}
      <style jsx>{`
        .quoteRichLayer {
          position: fixed;
          z-index: 1400;
          padding: 8px;
          border: 1px solid #cfc6eb;
          border-radius: 11px;
          background: #fff;
          box-shadow: 0 18px 50px rgba(44, 34, 81, 0.2);
        }
        .quoteRichLayerHeader {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 10px;
          padding: 2px 2px 8px;
          color: #302947;
        }
        .quoteRichLayerHeader > strong {
          font-size: 13px;
        }
        .quoteRichLayerHeader > span {
          color: #756d86;
          font-size: 10px;
        }
        .quoteRichLayerActions {
          display: flex;
          gap: 5px;
        }
        .quoteRichLayerActions button {
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 6px;
          padding: 0 8px;
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
        }
        .quoteRichLayerActions .secondary {
          border: 1px solid #d9d3e6;
          background: #fff;
          color: #514866;
        }
        .quoteRichLayerActions .primary {
          border: 1px solid #7158be;
          background: #7158be;
          color: #fff;
        }
        .quoteRichLayerError {
          margin: 6px 2px 0;
          color: #a32323;
          font-size: 11px;
          font-weight: 700;
        }
      `}</style>
    </div>,
    document.body,
  );
}
