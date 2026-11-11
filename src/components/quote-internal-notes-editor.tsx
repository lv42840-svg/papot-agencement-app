"use client";

import { LockKeyhole, Save } from "lucide-react";
import { type FormEvent, useState } from "react";
import { quoteRevisionHeaders } from "@/lib/quotes/concurrency";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type NotesResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

function errorLabel(code: string): string {
  if (code === "QUOTE_VERSION_CONFLICT")
    return "Ce devis a été modifié ailleurs. Recharge-le avant de recommencer.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un devis brouillon peut être modifié.";
  if (code === "QUOTE_INTERNAL_NOTES_INVALID") return "Les notes sont trop longues.";
  if (code === "MODULE_FORBIDDEN") return "Ton profil n’autorise pas la modification des devis.";
  return "Les notes internes n’ont pas pu être enregistrées.";
}

export function QuoteInternalNotesEditor({
  quote,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  onSaved: (contenu: NativeQuotesPayload) => void;
}) {
  const editable = canWrite && quote.status === "DRAFT";
  const [notes, setNotes] = useState(quote.internalNotes);
  const [sauvegardeEnCours, setSaving] = useState(false);
  const [erreur, setError] = useState("");
  const unchanged = notes === quote.internalNotes;

  async function save(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (!editable || sauvegardeEnCours || unchanged) return;

    setSaving(true);
    setError("");
    try {
      const reponse = await fetch(`/api/desktop/quotes/${quote.id}/notes`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...quoteRevisionHeaders(quote.updatedAt),
        },
        body: JSON.stringify({ internalNotes: notes }),
      });
      const donnees = (await reponse.json()) as NotesResponse;
      if (!reponse.ok || !donnees.payload) {
        setError(errorLabel(donnees.error ?? "QUOTE_INTERNAL_NOTES_UPDATE_FAILED"));
        return;
      }
      onSaved(donnees.payload);
      const savedQuote = donnees.payload.quotes.find((candidat) => candidat.id === quote.id);
      if (savedQuote) setNotes(savedQuote.internalNotes);
    } catch {
      setError("Les notes internes n’ont pas pu être enregistrées.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel quoteInternalNotes" aria-label="Notes internes de chiffrage">
      <div className="quoteInternalNotesHeader">
        <div>
          <p className="eyebrow">Chiffrage interne</p>
          <h3>Notes internes</h3>
        </div>
        <span className="quoteInternalBadge">
          <LockKeyhole size={12} aria-hidden="true" /> Interne PAPOT
        </span>
      </div>

      <p className="quoteInternalHint">
        Zone libre, jamais envoyée au client. Tu peux repérer une remarque par numéro de ligne, par
        exemple « Ligne 1.2 : prévoir… ».
      </p>

      {editable ? (
        <form onSubmit={save} className="quoteInternalForm">
          <textarea
            value={notes}
            onChange={(evenement) => setNotes(evenement.target.value)}
            rows={4}
            maxLength={20_000}
            placeholder="Ex. Ligne 1.2 : prévoir…"
            disabled={sauvegardeEnCours}
            aria-label="Notes internes du devis"
          />
          <div className="quoteInternalActions">
            <span>{notes.length.toLocaleString("fr-FR")} / 20 000</span>
            <button
              className="secondaryButton"
              type="submit"
              disabled={sauvegardeEnCours || unchanged}
            >
              <Save size={14} aria-hidden="true" />{" "}
              {sauvegardeEnCours ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
          {erreur ? <div className="quoteInternalError">{erreur}</div> : null}
        </form>
      ) : (
        <div className={`quoteInternalRead${quote.internalNotes ? "" : " isEmpty"}`}>
          {quote.internalNotes || "Aucune note interne."}
        </div>
      )}

      <style jsx>{`
        .quoteInternalNotes {
          padding: 16px 18px;
        }
        .quoteInternalNotesHeader,
        .quoteInternalBadge,
        .quoteInternalActions,
        .quoteInternalActions button {
          display: flex;
          align-items: center;
        }
        .quoteInternalNotesHeader {
          justify-content: space-between;
          gap: 14px;
        }
        .quoteInternalNotesHeader p,
        .quoteInternalNotesHeader h3 {
          margin-bottom: 0;
        }
        .quoteInternalNotesHeader h3 {
          font-size: 15px;
        }
        .quoteInternalBadge {
          gap: 5px;
          padding: 5px 8px;
          border-radius: 999px;
          background: #f1edfb;
          color: #6554b5;
          font-size: 10px;
          font-weight: 850;
          white-space: nowrap;
        }
        .quoteInternalHint {
          margin: 10px 0 0;
          color: var(--muted);
          font-size: 11px;
        }
        .quoteInternalForm {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }
        .quoteInternalForm textarea {
          width: 100%;
          min-height: 92px;
          padding: 9px 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
          color: var(--text);
          font: inherit;
          line-height: 1.45;
          resize: vertical;
        }
        .quoteInternalForm textarea:focus {
          outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
          border-color: var(--accent);
        }
        .quoteInternalActions {
          justify-content: space-between;
          gap: 12px;
        }
        .quoteInternalActions > span {
          color: var(--muted);
          font-size: 10px;
        }
        .quoteInternalActions button {
          gap: 6px;
        }
        .quoteInternalError {
          padding: 9px 11px;
          border-radius: 7px;
          background: #fff0f0;
          color: #9c3434;
          font-size: 11px;
          font-weight: 700;
        }
        .quoteInternalRead {
          margin-top: 10px;
          padding: 10px 12px;
          border: 1px solid #e4def2;
          border-radius: 8px;
          background: #faf8ff;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .quoteInternalRead.isEmpty {
          color: var(--muted);
          font-style: italic;
        }
      `}</style>
    </section>
  );
}
