"use client";

import { type FormEvent, useMemo, useState } from "react";
import { FilePlus2, FileText } from "lucide-react";
import { QuoteLinesEditor } from "@/components/quote-lines-editor";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export type QuoteAffairOption = {
  id: string;
  name: string;
  siteLabel: string;
  clientName: string;
  paymentTerms: string;
};

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  focusQuoteId?: string;
  error?: string;
};

const STATUS_LABELS = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
} as const;

function quoteErrorLabel(code: string): string {
  if (code === "QUOTE_AFFAIR_NOT_FOUND") return "L’affaire sélectionnée n’existe plus.";
  if (code === "QUOTE_AFFAIR_CLOSED") return "Cette affaire est fermée.";
  if (code === "QUOTE_CLIENT_NOT_FOUND") return "Cette affaire doit être liée à un client.";
  if (code === "QUOTE_CLIENT_ARCHIVED") return "Le client lié à cette affaire est archivé.";
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie les informations du brouillon.";
  return "Le brouillon n’a pas pu être enregistré.";
}

export function QuotesWorkspace({
  initialPayload,
  affairs,
  canWrite,
  today,
}: {
  initialPayload: NativeQuotesPayload;
  affairs: QuoteAffairOption[];
  canWrite: boolean;
  today: string;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeQuoteId, setActiveQuoteId] = useState(initialPayload.quotes[0]?.id ?? "");
  const [selectedAffairId, setSelectedAffairId] = useState(affairs[0]?.id ?? "");
  const firstAffair = affairs[0];
  const [subject, setSubject] = useState(firstAffair?.name ?? "");
  const [variantName, setVariantName] = useState("Base");
  const [issueDate, setIssueDate] = useState(today);
  const [paymentTerms, setPaymentTerms] = useState(firstAffair?.paymentTerms ?? "");

  const affairsById = useMemo(
    () => new Map(affairs.map((affair) => [affair.id, affair])),
    [affairs],
  );
  const sortedQuotes = useMemo(
    () => [...payload.quotes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [payload.quotes],
  );
  const activeQuote = useMemo(
    () => payload.quotes.find((quote) => quote.id === activeQuoteId) ?? null,
    [activeQuoteId, payload.quotes],
  );

  function selectAffair(affairId: string) {
    setSelectedAffairId(affairId);
    const affair = affairsById.get(affairId);
    setSubject(affair?.name ?? "");
    setPaymentTerms(affair?.paymentTerms ?? "");
  }

  function openCreateForm() {
    const affair = affairsById.get(selectedAffairId) ?? affairs[0];
    if (!affair) return;
    setSelectedAffairId(affair.id);
    setSubject(affair.name);
    setPaymentTerms(affair.paymentTerms);
    setVariantName("Base");
    setIssueDate(today);
    setError("");
    setFormOpen(true);
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createDraft",
          commercialCaseId: selectedAffairId,
          subject,
          issueDate,
          variantName,
          paymentTerms,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(quoteErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      setPayload(data.payload);
      if (data.focusQuoteId) setActiveQuoteId(data.focusQuoteId);
      setFormOpen(false);
    } catch {
      setError("Le brouillon n’a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="quoteWorkspace">
      <section className="panel quoteListShell" aria-label="Liste des devis natifs">
        <div className="panelHeader quoteListHeader">
          <div>
            <h2>Devis natifs</h2>
            <p className="muted">
              Brouillons, variantes et versions restent rattachés à leur affaire et leur client.
            </p>
          </div>
          <div className="quoteHeaderActions">
            <span className="countBadge">{payload.quotes.length}</span>
            {canWrite ? (
              <button
                type="button"
                className="primaryButton"
                onClick={openCreateForm}
                disabled={affairs.length === 0 || saving}
              >
                <FilePlus2 size={16} aria-hidden="true" />
                Nouveau devis
              </button>
            ) : null}
          </div>
        </div>

        {affairs.length === 0 && canWrite ? (
          <div className="quoteNotice">
            Lie d’abord un client à une affaire active pour pouvoir créer son devis.
          </div>
        ) : null}

        {formOpen ? (
          <form className="quoteDraftForm" onSubmit={createDraft}>
            <div className="quoteDraftFormHeader">
              <div>
                <p className="eyebrow">Nouveau</p>
                <h3>Brouillon de devis</h3>
              </div>
              <span className="quoteDraftPill">Pas encore numéroté</span>
            </div>

            <div className="quoteDraftGrid">
              <label className="quoteField quoteFieldWide">
                <span>Affaire</span>
                <select
                  value={selectedAffairId}
                  onChange={(event) => selectAffair(event.target.value)}
                  required
                >
                  {affairs.map((affair) => (
                    <option key={affair.id} value={affair.id}>
                      {affair.clientName} · {affair.name}
                      {affair.siteLabel ? ` · ${affair.siteLabel}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="quoteField quoteFieldWide">
                <span>Objet</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={240}
                  required
                />
              </label>

              <label className="quoteField">
                <span>Variante</span>
                <input
                  value={variantName}
                  onChange={(event) => setVariantName(event.target.value)}
                  maxLength={120}
                  required
                />
              </label>

              <label className="quoteField">
                <span>Date du devis</span>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                  required
                />
              </label>

              <label className="quoteField quoteFieldWide">
                <span>Conditions de règlement</span>
                <textarea
                  value={paymentTerms}
                  onChange={(event) => setPaymentTerms(event.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="Reprises automatiquement depuis le client lorsqu’elles sont renseignées"
                  required
                />
              </label>
            </div>

            {error ? <div className="quoteFormError">{error}</div> : null}

            <div className="quoteDraftActions">
              <button type="button" className="secondaryButton" onClick={() => setFormOpen(false)}>
                Annuler
              </button>
              <button type="submit" className="primaryButton" disabled={saving}>
                {saving ? "Enregistrement…" : "Créer le brouillon"}
              </button>
            </div>
          </form>
        ) : null}

        {sortedQuotes.length === 0 ? (
          <div className="quoteEmptyState">
            <FileText size={28} aria-hidden="true" />
            <strong>Aucun devis natif pour le moment</strong>
            <span>
              Le premier brouillon créé apparaîtra ici sans consommer de numéro définitif.
            </span>
          </div>
        ) : (
          <div className="quoteDraftList">
            {sortedQuotes.map((quote) => {
              const affair = affairsById.get(quote.commercialCaseId);
              const active = quote.id === activeQuoteId;
              return (
                <button
                  type="button"
                  className={`quoteDraftRow${active ? " isActive" : ""}`}
                  key={quote.id}
                  onClick={() => setActiveQuoteId(quote.id)}
                  aria-pressed={active}
                >
                  <div className="quoteDraftMain">
                    <FileText size={17} aria-hidden="true" />
                    <div>
                      <strong>{quote.model.subject}</strong>
                      <span>
                        {affair?.clientName ?? "Client"} · {affair?.name ?? "Affaire"}
                      </span>
                    </div>
                  </div>
                  <div className="quoteDraftMeta">
                    <span>{quote.variantName}</span>
                    <span>V{quote.version}</span>
                    <span>{quote.model.issueDate}</span>
                    <strong>{STATUS_LABELS[quote.status]}</strong>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <QuoteLinesEditor quote={activeQuote} canWrite={canWrite} onSaved={setPayload} />

      <style jsx>{`
        .quoteWorkspace {
          display: grid;
          gap: 18px;
        }
        .quoteListHeader,
        .quoteHeaderActions,
        .quoteDraftFormHeader,
        .quoteDraftActions,
        .quoteDraftMain,
        .quoteDraftMeta {
          display: flex;
          align-items: center;
        }
        .quoteListHeader,
        .quoteDraftFormHeader {
          justify-content: space-between;
          gap: 16px;
        }
        .quoteHeaderActions,
        .quoteDraftActions,
        .quoteDraftMain,
        .quoteDraftMeta {
          gap: 10px;
        }
        .quoteHeaderActions :global(button),
        .quoteDraftActions :global(button) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .quoteNotice {
          margin: 0 18px 18px;
          padding: 12px 14px;
          border: 1px solid #e4def5;
          border-radius: 8px;
          background: #faf8ff;
          color: var(--muted);
          font-size: 12px;
        }
        .quoteDraftForm {
          margin: 0 18px 18px;
          padding: 18px;
          display: grid;
          gap: 16px;
          border: 1px solid #dcd5f0;
          border-radius: 10px;
          background: #fcfbff;
        }
        .quoteDraftFormHeader {
          align-items: flex-start;
        }
        .quoteDraftFormHeader h3,
        .quoteDraftFormHeader p {
          margin-bottom: 0;
        }
        .quoteDraftPill {
          padding: 5px 9px;
          border-radius: 999px;
          background: #eee9fb;
          color: #6654be;
          font-size: 11px;
          font-weight: 700;
        }
        .quoteDraftGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .quoteField {
          display: grid;
          gap: 6px;
        }
        .quoteFieldWide {
          grid-column: 1 / -1;
        }
        .quoteField span {
          font-size: 11px;
          font-weight: 800;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteField input,
        .quoteField select,
        .quoteField textarea {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: #fff;
        }
        .quoteField textarea {
          resize: vertical;
        }
        .quoteFormError {
          padding: 9px 11px;
          border-radius: 7px;
          background: #fff0f0;
          color: #9c3434;
          font-size: 12px;
          font-weight: 700;
        }
        .quoteDraftActions {
          justify-content: flex-end;
        }
        .quoteDraftList {
          display: grid;
          border-top: 1px solid var(--border);
        }
        .quoteDraftRow {
          width: 100%;
          min-height: 68px;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border: 0;
          border-bottom: 1px solid var(--border);
          border-radius: 0;
          background: #fff;
          color: inherit;
          text-align: left;
        }
        .quoteDraftRow:hover,
        .quoteDraftRow.isActive {
          background: #faf8ff;
        }
        .quoteDraftRow.isActive {
          box-shadow: inset 3px 0 0 var(--accent);
        }
        .quoteDraftRow:last-child {
          border-bottom: 0;
        }
        .quoteDraftMain {
          min-width: 0;
          align-items: flex-start;
        }
        .quoteDraftMain > :global(svg) {
          flex: 0 0 auto;
          margin-top: 2px;
          color: var(--accent);
        }
        .quoteDraftMain strong,
        .quoteDraftMain span {
          display: block;
        }
        .quoteDraftMain strong {
          margin-bottom: 3px;
          font-size: 13px;
        }
        .quoteDraftMain span {
          color: var(--muted);
          font-size: 11px;
        }
        .quoteDraftMeta {
          flex: 0 0 auto;
          color: var(--muted);
          font-size: 11px;
        }
        .quoteDraftMeta strong {
          padding: 4px 7px;
          border-radius: 999px;
          background: #eee9fb;
          color: #6654be;
        }
        .quoteEmptyState {
          min-height: 180px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 7px;
          padding: 28px;
          text-align: center;
          color: var(--muted);
        }
        .quoteEmptyState > :global(svg) {
          color: color-mix(in srgb, var(--accent) 65%, var(--muted));
        }
        .quoteEmptyState strong {
          color: var(--text);
          font-size: 14px;
        }
        .quoteEmptyState span {
          max-width: 560px;
          font-size: 12px;
          line-height: 1.5;
        }
        @media (max-width: 900px) {
          .quoteDraftGrid {
            grid-template-columns: 1fr;
          }
          .quoteFieldWide {
            grid-column: auto;
          }
          .quoteDraftRow {
            align-items: flex-start;
            flex-direction: column;
          }
          .quoteDraftMeta {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}
