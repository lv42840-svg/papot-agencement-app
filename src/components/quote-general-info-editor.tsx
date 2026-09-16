"use client";

import { Check, LockKeyhole, Pencil, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type QuoteDetailsResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR").format(new Date(`${value}T12:00:00`));
}

function errorLabel(code: string): string {
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un devis brouillon peut être modifié.";
  if (code === "QUOTE_DETAILS_INVALID") return "Vérifie les informations du devis.";
  if (code === "MODULE_FORBIDDEN") return "Ton profil n’autorise pas la modification des devis.";
  return "Les informations du devis n’ont pas pu être enregistrées.";
}

export function QuoteGeneralInfoEditor({
  quote,
  clientName,
  affairName,
  paymentTermOptions,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  clientName: string;
  affairName: string;
  paymentTermOptions: string[];
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
}) {
  const editable = canWrite && quote.status === "DRAFT";
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(quote.model.subject);
  const [issueDate, setIssueDate] = useState(quote.model.issueDate);
  const [paymentTerms, setPaymentTerms] = useState(quote.model.paymentTerms);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const availablePaymentTerms = Array.from(
    new Set(
      [quote.model.paymentTerms, ...paymentTermOptions]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  function openEditor() {
    setSubject(quote.model.subject);
    setIssueDate(quote.model.issueDate);
    setPaymentTerms(quote.model.paymentTerms);
    setError("");
    setEditing(true);
  }

  function closeEditor() {
    setError("");
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || saving) return;

    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/desktop/quotes/${quote.id}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          issueDate,
          paymentTerms,
        }),
      });
      const data = (await response.json()) as QuoteDetailsResponse;
      if (!response.ok || !data.payload) {
        setError(errorLabel(data.error ?? "QUOTE_DETAILS_UPDATE_FAILED"));
        return;
      }
      onSaved(data.payload);
      setEditing(false);
    } catch {
      setError("Les informations du devis n’ont pas pu être enregistrées.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel quoteGeneralInfo" aria-label="Informations générales du devis">
      <div className="quoteGeneralHeader">
        <div>
          <p className="eyebrow">Informations du devis</p>
          <h3>Client, affaire et paramètres</h3>
        </div>
        {editable && !editing ? (
          <button className="secondaryButton quoteGeneralEdit" type="button" onClick={openEditor}>
            <Pencil size={14} aria-hidden="true" /> Modifier
          </button>
        ) : null}
      </div>

      {editing ? (
        <form className="quoteGeneralForm" onSubmit={save}>
          <div className="quoteGeneralReadonly">
            <div>
              <span>Client</span>
              <strong>{clientName}</strong>
            </div>
            <div>
              <span>Affaire</span>
              <strong>{affairName}</strong>
            </div>
            <small>
              <LockKeyhole size={12} aria-hidden="true" /> Le client et l’affaire restent liés au
              dossier commercial d’origine.
            </small>
          </div>

          <label className="quoteGeneralField quoteGeneralWide">
            <span>Objet</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={240}
              required
              disabled={saving}
            />
          </label>

          <div className="quoteGeneralField">
            <span>Variante</span>
            <div className="quoteGeneralStructuredValue">
              <strong>{quote.variantName}</strong>
            </div>
          </div>

          <label className="quoteGeneralField">
            <span>Date du devis</span>
            <input
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
              required
              disabled={saving}
            />
          </label>

          <label className="quoteGeneralField">
            <span>Conditions de règlement</span>
            <select
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
              required
              disabled={saving}
            >
              {availablePaymentTerms.map((terms) => (
                <option key={terms} value={terms}>
                  {terms}
                </option>
              ))}
            </select>
          </label>

          {error ? <div className="quoteGeneralError quoteGeneralWide">{error}</div> : null}

          <div className="quoteGeneralActions quoteGeneralWide">
            <button className="primaryButton" type="submit" disabled={saving}>
              <Check size={14} aria-hidden="true" /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={closeEditor}
              disabled={saving}
            >
              <X size={14} aria-hidden="true" /> Annuler
            </button>
          </div>
        </form>
      ) : (
        <div className="quoteGeneralGrid">
          <div className="quoteGeneralValue">
            <span>Client</span>
            <strong>{clientName}</strong>
          </div>
          <div className="quoteGeneralValue">
            <span>Affaire</span>
            <strong>{affairName}</strong>
          </div>
          <div className="quoteGeneralValue quoteGeneralWide">
            <span>Objet</span>
            <strong>{quote.model.subject}</strong>
          </div>
          <div className="quoteGeneralValue">
            <span>Variante</span>
            <strong>{quote.variantName}</strong>
          </div>
          <div className="quoteGeneralValue">
            <span>Date du devis</span>
            <strong>{formatDate(quote.model.issueDate)}</strong>
          </div>
          <div className="quoteGeneralValue">
            <span>Conditions de règlement</span>
            <strong>{quote.model.paymentTerms}</strong>
          </div>
        </div>
      )}

      <style jsx>{`
        .quoteGeneralInfo {
          padding: 16px 18px;
        }
        .quoteGeneralHeader,
        .quoteGeneralActions,
        .quoteGeneralReadonly small {
          display: flex;
          align-items: center;
        }
        .quoteGeneralHeader {
          justify-content: space-between;
          gap: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border);
        }
        .quoteGeneralHeader h3,
        .quoteGeneralHeader p {
          margin-bottom: 0;
        }
        .quoteGeneralHeader h3 {
          font-size: 15px;
        }
        .quoteGeneralEdit,
        .quoteGeneralActions button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .quoteGeneralGrid,
        .quoteGeneralForm {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px 16px;
          padding-top: 14px;
        }
        .quoteGeneralValue,
        .quoteGeneralField {
          min-width: 0;
          display: grid;
          gap: 5px;
        }
        .quoteGeneralValue > span,
        .quoteGeneralField > span,
        .quoteGeneralReadonly span {
          color: var(--muted);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.035em;
        }
        .quoteGeneralValue strong,
        .quoteGeneralReadonly strong,
        .quoteGeneralStructuredValue strong {
          min-width: 0;
          font-size: 13px;
          overflow-wrap: anywhere;
        }
        .quoteGeneralValue strong,
        .quoteGeneralReadonly strong {
          white-space: pre-line;
        }
        .quoteGeneralWide {
          grid-column: 1 / -1;
        }
        .quoteGeneralField input,
        .quoteGeneralField select,
        .quoteGeneralStructuredValue {
          width: 100%;
          min-height: 36px;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: #fff;
          color: var(--text);
          font: inherit;
        }
        .quoteGeneralField input,
        .quoteGeneralField select {
          height: 36px;
          padding: 0 9px;
        }
        .quoteGeneralStructuredValue {
          display: flex;
          align-items: center;
          padding: 0 9px;
          background: #faf8ff;
          border-color: #e4def2;
        }
        .quoteGeneralField input:focus,
        .quoteGeneralField select:focus {
          outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
          border-color: var(--accent);
        }
        .quoteGeneralReadonly {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px 16px;
          padding: 10px 12px;
          border: 1px solid #e4def2;
          border-radius: 8px;
          background: #faf8ff;
        }
        .quoteGeneralReadonly > div {
          display: grid;
          gap: 4px;
        }
        .quoteGeneralReadonly small {
          grid-column: 1 / -1;
          gap: 5px;
          color: var(--muted);
          font-size: 10px;
        }
        .quoteGeneralActions {
          gap: 8px;
        }
        .quoteGeneralError {
          padding: 9px 11px;
          border-radius: 7px;
          background: #fff0f0;
          color: #9c3434;
          font-size: 11px;
          font-weight: 700;
        }
        @media (max-width: 820px) {
          .quoteGeneralGrid,
          .quoteGeneralForm {
            grid-template-columns: 1fr;
          }
          .quoteGeneralWide,
          .quoteGeneralReadonly,
          .quoteGeneralReadonly small {
            grid-column: auto;
          }
          .quoteGeneralReadonly {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
