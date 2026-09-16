"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { QuoteRichTextEditor } from "@/components/quote-rich-text-editor";
import { QuoteStructuredLinesEditor } from "@/components/quote-structured-lines-editor";
import type { QuoteItem, QuoteRichText } from "@/lib/quotes/model";
import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";
import {
  normalizeQuoteRichText,
  quoteRichTextFromPlainText,
  quoteRichTextToPlainText,
  resolveQuoteRichText,
} from "@/lib/quotes/rich-text";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type Props = {
  quote: NativeQuoteRecord | null;
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
  headerActions?: ReactNode;
};

type RichEditableKind = "SECTION" | "SUBSECTION" | "LINE";

type RichSession = {
  key: string;
  kind: RichEditableKind;
  itemId?: string;
  richText: QuoteRichText;
};

type PendingRichSave = {
  kind: RichEditableKind;
  itemId?: string;
  richText: QuoteRichText;
  beforeItemIds: ReadonlySet<string>;
};

type RichSaveResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

type Anchor = {
  left: number;
  top: number;
  width: number;
};

function itemText(item: QuoteItem): string | null {
  if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.title;
  if (item.kind === "LINE") return item.description;
  return null;
}

function trimmedRichText(value: QuoteRichText): QuoteRichText {
  const plain = quoteRichTextToPlainText(value);
  const trimmed = plain.trim();
  if (!trimmed) return { runs: [] };

  const start = plain.indexOf(trimmed);
  const end = start + trimmed.length;
  const runs: QuoteRichText["runs"] = [];
  let cursor = 0;

  for (const run of value.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= start || runStart >= end) continue;

    const localStart = Math.max(0, start - runStart);
    const localEnd = Math.min(run.text.length, end - runStart);
    const text = run.text.slice(localStart, localEnd);
    if (text) runs.push({ text, style: { ...run.style } });
  }

  return normalizeQuoteRichText({ runs });
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function editableKind(input: HTMLInputElement): RichEditableKind | null {
  if (input.closest(".quoteOuvrageEditing")) return "LINE";
  if (!input.closest(".quoteHeadingEditing")) return null;
  return input.placeholder === "Sous-titre" ? "SUBSECTION" : "SECTION";
}

function itemMatchesKind(item: QuoteItem, kind: RichEditableKind): boolean {
  return item.kind === kind;
}

export function QuoteStructuredLinesRichEditor({ quote, canWrite, onSaved, headerActions }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<RichSession | null>(null);
  const pendingSaveRef = useRef<PendingRichSave | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<RichSession | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [richSaveError, setRichSaveError] = useState("");

  const itemByNumber = useMemo(() => {
    const map = new Map<string, QuoteItem>();
    if (!quote) return map;
    const numbers = buildQuoteItemNumbers(quote.model.items);
    for (const item of quote.model.items) {
      const number = numbers.get(item.id);
      if (number) map.set(number, item);
    }
    return map;
  }, [quote]);

  function updateSession(next: RichSession | null) {
    sessionRef.current = next;
    setSession(next);
  }

  function measureInput(input: HTMLInputElement) {
    const rect = input.getBoundingClientRect();
    const maxWidth = Math.max(300, window.innerWidth - 24);
    const width = Math.min(Math.max(rect.width, 460), maxWidth);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const top = Math.max(8, rect.top - 40);
    setAnchor({ left, top, width });
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !quote || !canWrite) return;

    let resizeObserver: ResizeObserver | null = null;

    const detachCurrentInput = () => {
      if (activeInputRef.current) activeInputRef.current.style.visibility = "";
      activeInputRef.current = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    const findEditingInput = () =>
      root.querySelector<HTMLInputElement>(
        ".quoteHeadingEditing .quoteDescriptionInput, .quoteOuvrageEditing .quoteDescriptionInput",
      );

    const connect = () => {
      const input = findEditingInput();
      if (!input) {
        if (activeInputRef.current) {
          detachCurrentInput();
          updateSession(null);
          setAnchor(null);
        }
        return;
      }

      const kind = editableKind(input);
      if (!kind) return;
      const row = input.closest<HTMLElement>(".quoteMainRow");
      const number = row?.querySelector<HTMLElement>(".quoteNumber")?.textContent?.trim() ?? "+";
      const item = number === "+" ? undefined : itemByNumber.get(number);
      const itemId = item && itemMatchesKind(item, kind) ? item.id : undefined;
      const key = `${kind}:${itemId ?? "new"}:${number}`;

      if (input !== activeInputRef.current) {
        detachCurrentInput();
        activeInputRef.current = input;
        input.style.visibility = "hidden";
        resizeObserver = new ResizeObserver(() => measureInput(input));
        resizeObserver.observe(input);
      }

      measureInput(input);

      const current = sessionRef.current;
      if (current?.key === key) return;

      const text = item ? (itemText(item) ?? input.value) : input.value;
      const richText = item
        ? resolveQuoteRichText(text, item.presentation?.richText, item.presentation?.textStyle)
        : quoteRichTextFromPlainText(text);
      updateSession({ key, kind, itemId, richText });
      setRichSaveError("");
    };

    connect();
    const observer = new MutationObserver(connect);
    observer.observe(root, { childList: true, subtree: true });

    const reposition = () => {
      if (activeInputRef.current) measureInput(activeInputRef.current);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    const rememberPendingSave = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.matches(".quoteHeadingEditing, .quoteOuvrageEditing")) return;
      const current = sessionRef.current;
      if (!current) return;
      pendingSaveRef.current = {
        kind: current.kind,
        itemId: current.itemId,
        richText: trimmedRichText(current.richText),
        beforeItemIds: new Set(quote.model.items.map((item) => item.id)),
      };
    };
    root.addEventListener("submit", rememberPendingSave, true);

    return () => {
      observer.disconnect();
      root.removeEventListener("submit", rememberPendingSave, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      detachCurrentInput();
    };
  }, [canWrite, itemByNumber, quote]);

  const sessionKey = session?.key;

  useEffect(() => {
    if (!sessionKey) return;
    const frame = window.requestAnimationFrame(() => {
      overlayRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionKey]);

  async function handleStructuredSaved(payload: NativeQuotesPayload) {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending || !quote) {
      onSaved(payload);
      return;
    }

    const updatedQuote = payload.quotes.find((candidate) => candidate.id === quote.id);
    const plainText = quoteRichTextToPlainText(pending.richText);
    if (!updatedQuote || !plainText) {
      onSaved(payload);
      return;
    }

    const target = pending.itemId
      ? updatedQuote.model.items.find(
          (item) => item.id === pending.itemId && itemMatchesKind(item, pending.kind),
        )
      : updatedQuote.model.items.find(
          (item) =>
            !pending.beforeItemIds.has(item.id) &&
            itemMatchesKind(item, pending.kind) &&
            itemText(item) === plainText,
        );

    if (!target) {
      setRichSaveError("Le texte est enregistré, mais sa mise en forme n’a pas pu être associée.");
      onSaved(payload);
      return;
    }

    try {
      const response = await fetch(
        `/api/desktop/quotes/${updatedQuote.id}/items/${target.id}/rich-text`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: plainText, richText: pending.richText }),
        },
      );
      const data = (await response.json()) as RichSaveResponse;
      if (!response.ok || !data.payload) {
        throw new Error(data.error ?? "QUOTE_RICH_TEXT_SAVE_FAILED");
      }
      setRichSaveError("");
      onSaved(data.payload);
    } catch {
      setRichSaveError(
        "Le texte est enregistré, mais la mise en forme n’a pas pu être enregistrée.",
      );
      onSaved(payload);
    }
  }

  function changeRichText(next: QuoteRichText) {
    const current = sessionRef.current;
    const input = activeInputRef.current;
    if (!current || !input) return;
    const updated = { ...current, richText: next };
    updateSession(updated);
    setNativeInputValue(input, quoteRichTextToPlainText(next));
    measureInput(input);
  }

  return (
    <div ref={rootRef} className="quoteStructuredRichEditor">
      <QuoteStructuredLinesEditor
        quote={quote}
        canWrite={canWrite}
        onSaved={(payload) => void handleStructuredSaved(payload)}
        headerActions={headerActions}
      />

      {session && anchor ? (
        <div
          ref={overlayRef}
          className="quoteRichInlineOverlay"
          style={{ left: anchor.left, top: anchor.top, width: anchor.width }}
        >
          <QuoteRichTextEditor
            value={session.richText}
            onChange={changeRichText}
            ariaLabel={session.kind === "LINE" ? "Désignation de l’ouvrage" : "Texte du titre"}
            maxLength={session.kind === "LINE" ? 4000 : 500}
          />
        </div>
      ) : null}

      {richSaveError ? <div className="quoteRichInlineError">{richSaveError}</div> : null}

      <style jsx global>{`
        .quoteStructuredRichEditor .quoteRowActions button[title="Mise en forme client"] {
          display: none !important;
        }
        .quoteRichInlineOverlay {
          position: fixed;
          z-index: 1600;
        }
        .quoteRichInlineOverlay .quoteRichEditorShell {
          box-shadow: 0 12px 34px rgba(44, 34, 81, 0.2);
        }
        .quoteRichInlineOverlay .quoteRichToolbar {
          min-height: 34px;
          padding-top: 3px;
          padding-bottom: 3px;
        }
        .quoteRichInlineOverlay .quoteRichEditable {
          min-height: 34px;
          padding: 7px 10px;
        }
        .quoteRichInlineError {
          margin-top: -6px;
          padding: 8px 10px;
          border: 1px solid #f0b8b8;
          border-radius: 8px;
          background: #fff4f4;
          color: #9f2525;
          font-size: 12px;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
