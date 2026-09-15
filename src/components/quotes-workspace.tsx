"use client";

import Link from "next/link";
import { FilePlus2, FileText } from "lucide-react";
import { useMemo } from "react";
import { newQuoteHref, quoteHref } from "@/lib/quotes/navigation";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export type QuoteAffairOption = {
  id: string;
  name: string;
  siteLabel: string;
  clientName: string;
  paymentTerms: string;
};

const STATUS_LABELS = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
} as const;

export function QuotesWorkspace({
  initialPayload,
  affairs,
  canWrite,
}: {
  initialPayload: NativeQuotesPayload;
  affairs: QuoteAffairOption[];
  canWrite: boolean;
}) {
  const affairsById = useMemo(
    () => new Map(affairs.map((affair) => [affair.id, affair])),
    [affairs],
  );
  const sortedQuotes = useMemo(
    () =>
      [...initialPayload.quotes].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [initialPayload.quotes],
  );

  return (
    <div className="quoteWorkspace">
      <section className="panel quoteListShell" aria-label="Liste des devis natifs">
        <div className="panelHeader quoteListHeader">
          <div>
            <h2>Devis</h2>
            <p className="muted">Ouvre un devis pour travailler dessus dans sa fiche dédiée.</p>
          </div>
          <div className="quoteHeaderActions">
            <span className="countBadge">{initialPayload.quotes.length}</span>
            {canWrite ? (
              <Link
                href={newQuoteHref}
                className={`primaryButton quoteCreateLink${
                  affairs.length === 0 ? " isDisabled" : ""
                }`}
                aria-disabled={affairs.length === 0}
                tabIndex={affairs.length === 0 ? -1 : undefined}
              >
                <FilePlus2 size={16} aria-hidden="true" />
                Nouveau devis
              </Link>
            ) : null}
          </div>
        </div>

        {affairs.length === 0 && canWrite ? (
          <div className="quoteNotice">
            Lie d’abord un client à une affaire active pour pouvoir créer son devis.
          </div>
        ) : null}

        {sortedQuotes.length === 0 ? (
          <div className="quoteEmptyState">
            <FileText size={28} aria-hidden="true" />
            <strong>Aucun devis pour le moment</strong>
            <span>Le premier devis créé apparaîtra ici.</span>
          </div>
        ) : (
          <div className="quoteDraftList">
            {sortedQuotes.map((quote) => {
              const affair = affairsById.get(quote.commercialCaseId);
              return (
                <Link className="quoteDraftRow" key={quote.id} href={quoteHref(quote.id)}>
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
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <style jsx>{`
        .quoteWorkspace {
          display: grid;
          gap: 18px;
        }
        .quoteListHeader,
        .quoteHeaderActions,
        .quoteDraftMain,
        .quoteDraftMeta {
          display: flex;
          align-items: center;
        }
        .quoteListHeader {
          justify-content: space-between;
          gap: 16px;
        }
        .quoteHeaderActions,
        .quoteDraftMain,
        .quoteDraftMeta {
          gap: 10px;
        }
        .quoteListHeader h2,
        .quoteListHeader p {
          margin-bottom: 0;
        }
        .quoteHeaderActions :global(.quoteCreateLink) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          text-decoration: none;
        }
        .quoteHeaderActions :global(.quoteCreateLink.isDisabled) {
          pointer-events: none;
          opacity: 0.45;
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
          border-bottom: 1px solid var(--border);
          background: #fff;
          color: inherit;
          text-align: left;
          text-decoration: none;
        }
        .quoteDraftRow:hover {
          background: #faf8ff;
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
          .quoteDraftRow,
          .quoteListHeader {
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
