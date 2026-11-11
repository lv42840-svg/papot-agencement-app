"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QuoteRichTextEditor } from "@/components/quote-rich-text-editor";
import { QuoteStructuredLinesEditor } from "@/components/quote-structured-lines-editor";
import { quoteRevisionHeaders } from "@/lib/quotes/concurrency";
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
  onSaved: (contenu: NativeQuotesPayload) => void;
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

function itemText(element: QuoteItem): string | null {
  if (element.kind === "SECTION" || element.kind === "SUBSECTION") return element.title;
  if (element.kind === "LINE") return element.description;
  return null;
}

function trimmedRichText(valeur: QuoteRichText): QuoteRichText {
  const plain = quoteRichTextToPlainText(valeur);
  const trimmed = plain.trim();
  if (!trimmed) return { runs: [] };

  const debut = plain.indexOf(trimmed);
  const fin = debut + trimmed.length;
  const runs: QuoteRichText["runs"] = [];
  let cursor = 0;

  for (const run of valeur.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= debut || runStart >= fin) continue;

    const localStart = Math.max(0, debut - runStart);
    const localEnd = Math.min(run.text.length, fin - runStart);
    const texte = run.text.slice(localStart, localEnd);
    if (texte) runs.push({ text: texte, style: { ...run.style } });
  }

  return normalizeQuoteRichText({ runs });
}

function plainTextForNativeInput(valeur: string): string {
  return valeur.replace(/\r\n?|\n/g, " ");
}

function setNativeInputValue(saisie: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const nativeValue = plainTextForNativeInput(valeur);
  if (setter) setter.call(saisie, nativeValue);
  else saisie.value = nativeValue;
  saisie.dispatchEvent(new Event("input", { bubbles: true }));
}

function editableKind(saisie: HTMLInputElement): RichEditableKind | null {
  if (saisie.closest(".quoteOuvrageEditing")) return "LINE";
  if (!saisie.closest(".quoteHeadingEditing")) return null;
  return saisie.placeholder === "Sous-titre" ? "SUBSECTION" : "SECTION";
}

function itemMatchesKind(element: QuoteItem, kind: RichEditableKind): boolean {
  return element.kind === kind;
}

export function QuoteStructuredLinesRichEditor({ quote, canWrite, onSaved, headerActions }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const activeHostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<RichSession | null>(null);
  const pendingSaveRef = useRef<PendingRichSave | null>(null);
  const [activeHost, setActiveHost] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<RichSession | null>(null);
  const [richSaveError, setRichSaveError] = useState("");

  const itemByNumber = useMemo(() => {
    const map = new Map<string, QuoteItem>();
    if (!quote) return map;
    const numbers = buildQuoteItemNumbers(quote.model.items);
    for (const element of quote.model.items) {
      const number = numbers.get(element.id);
      if (number) map.set(number, element);
    }
    return map;
  }, [quote]);

  function updateSession(suivant: RichSession | null) {
    sessionRef.current = suivant;
    setSession(suivant);
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !quote || !canWrite) return;

    const detachCurrentInput = () => {
      if (activeInputRef.current) activeInputRef.current.style.display = "";
      activeInputRef.current = null;
      activeHostRef.current?.remove();
      activeHostRef.current = null;
      setActiveHost(null);
    };

    const findEditingInput = () =>
      root.querySelector<HTMLInputElement>(
        ".quoteHeadingEditing .quoteDescriptionInput, .quoteOuvrageEditing .quoteDescriptionInput",
      );

    const connect = () => {
      const saisie = findEditingInput();
      if (!saisie) {
        if (activeInputRef.current) {
          detachCurrentInput();
          updateSession(null);
        }
        return;
      }

      const kind = editableKind(saisie);
      if (!kind) return;
      const ligneTableau = saisie.closest<HTMLElement>(".quoteMainRow");
      const number =
        ligneTableau?.querySelector<HTMLElement>(".quoteNumber")?.textContent?.trim() ?? "+";
      const element = number === "+" ? undefined : itemByNumber.get(number);
      const idElement = element && itemMatchesKind(element, kind) ? element.id : undefined;
      const cle = `${kind}:${idElement ?? "new"}:${number}`;

      if (saisie !== activeInputRef.current) {
        detachCurrentInput();
        const host = saisie.ownerDocument.createElement("div");
        host.className = "quoteRichInlineHost";
        saisie.insertAdjacentElement("beforebegin", host);
        saisie.style.display = "none";
        activeInputRef.current = saisie;
        activeHostRef.current = host;
        setActiveHost(host);
      }

      const courant = sessionRef.current;
      if (courant?.key === cle) return;

      const texte = element ? (itemText(element) ?? saisie.value) : saisie.value;
      const richText = element
        ? resolveQuoteRichText(
            texte,
            element.presentation?.richText,
            element.presentation?.textStyle,
          )
        : quoteRichTextFromPlainText(texte);
      updateSession({ key: cle, kind, itemId: idElement, richText });
      setRichSaveError("");
    };

    connect();
    const observer = new MutationObserver(connect);
    observer.observe(root, { childList: true, subtree: true });

    const rememberPendingSave = (evenement: Event) => {
      const form = evenement.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.matches(".quoteHeadingEditing, .quoteOuvrageEditing")) return;
      const courant = sessionRef.current;
      if (!courant) return;
      pendingSaveRef.current = {
        kind: courant.kind,
        itemId: courant.itemId,
        richText: trimmedRichText(courant.richText),
        beforeItemIds: new Set(quote.model.items.map((element) => element.id)),
      };
    };
    root.addEventListener("submit", rememberPendingSave, true);

    return () => {
      observer.disconnect();
      root.removeEventListener("submit", rememberPendingSave, true);
      detachCurrentInput();
    };
  }, [canWrite, itemByNumber, quote]);

  const sessionKey = session?.key;

  useEffect(() => {
    if (!sessionKey) return;
    const frame = window.requestAnimationFrame(() => {
      activeHostRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionKey]);

  async function handleStructuredSaved(contenu: NativeQuotesPayload) {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending || !quote) {
      onSaved(contenu);
      return;
    }

    const updatedQuote = contenu.quotes.find((candidat) => candidat.id === quote.id);
    const plainText = quoteRichTextToPlainText(pending.richText);
    if (!updatedQuote || !plainText) {
      onSaved(contenu);
      return;
    }

    const cible = pending.itemId
      ? updatedQuote.model.items.find(
          (element) => element.id === pending.itemId && itemMatchesKind(element, pending.kind),
        )
      : updatedQuote.model.items.find(
          (element) =>
            !pending.beforeItemIds.has(element.id) && itemMatchesKind(element, pending.kind),
        );

    if (!cible) {
      setRichSaveError("Le texte est enregistré, mais sa mise en forme n’a pas pu être associée.");
      onSaved(contenu);
      return;
    }

    try {
      const reponse = await fetch(
        `/api/desktop/quotes/${updatedQuote.id}/items/${cible.id}/rich-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...quoteRevisionHeaders(updatedQuote.updatedAt),
          },
          body: JSON.stringify({ text: plainText, richText: pending.richText }),
        },
      );
      const donnees = (await reponse.json()) as RichSaveResponse;
      if (!reponse.ok || !donnees.payload) {
        throw new Error(donnees.error ?? "QUOTE_RICH_TEXT_SAVE_FAILED");
      }
      setRichSaveError("");
      onSaved(donnees.payload);
    } catch {
      setRichSaveError(
        "Le texte est enregistré, mais la mise en forme n’a pas pu être enregistrée.",
      );
      onSaved(contenu);
    }
  }

  function changeRichText(suivant: QuoteRichText) {
    const courant = sessionRef.current;
    const saisie = activeInputRef.current;
    if (!courant || !saisie) return;
    const updated = { ...courant, richText: suivant };
    updateSession(updated);
    setNativeInputValue(saisie, quoteRichTextToPlainText(suivant));
  }

  return (
    <div ref={rootRef} className="quoteStructuredRichEditor">
      <QuoteStructuredLinesEditor
        quote={quote}
        canWrite={canWrite}
        onSaved={(contenu) => void handleStructuredSaved(contenu)}
        headerActions={headerActions}
      />

      {session && activeHost
        ? createPortal(
            <QuoteRichTextEditor
              value={session.richText}
              onChange={changeRichText}
              ariaLabel={session.kind === "LINE" ? "Désignation de l’ouvrage" : "Texte du titre"}
              maxLength={session.kind === "LINE" ? 4000 : 500}
            />,
            activeHost,
          )
        : null}

      {richSaveError ? <div className="quoteRichInlineError">{richSaveError}</div> : null}

      <style jsx global>{`
        .quoteStructuredRichEditor .quoteRowActions button[title="Mise en forme client"] {
          display: none !important;
        }
        .quoteRichInlineHost {
          min-width: 0;
          width: 100%;
          align-self: stretch;
        }
        .quoteRichInlineHost .quoteRichEditorShell {
          height: 100%;
          box-shadow: none;
        }
        .quoteRichInlineHost .quoteRichToolbar {
          min-height: 32px;
          padding: 3px 5px;
          flex-wrap: wrap;
        }
        .quoteRichInlineHost .quoteRichEditable {
          min-height: 34px;
          padding: 7px 9px;
        }
        .quoteRichInlineError {
          margin: 8px 18px;
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
