"use client";

import Link from "next/link";
import { FilePlus2, FileText, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommercialCase } from "@/lib/commercial/domain";
import {
  COMMERCIAL_QUOTE_STATUS_LABELS,
  commercialQuoteDisplayStatus,
  quoteEditorHref,
  type CommercialQuoteDisplayStatus,
} from "@/lib/commercial/quote-follow-up";
import { calculateCommercialQuoteSummary } from "@/lib/quotes/commercial-summary";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const hoursFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function moneyLabel(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function hoursLabel(hours: number): string {
  return `${hoursFormatter.format(hours)} h`;
}

function dateLabel(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function statusTone(status: CommercialQuoteDisplayStatus): string {
  if (status === "FOLLOW_UP") return "follow";
  if (status === "SENT") return "sent";
  if (status === "ACCEPTED") return "accepted";
  if (status === "REJECTED" || status === "CANCELLED") return "closed";
  return "draft";
}

export function CommercialAffairQuotes({ item }: { item: CommercialCase }) {
  const [payload, setPayload] = useState<NativeQuotesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    void fetch("/api/desktop/quotes", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as QuotesApiResponse;
        if (!response.ok || !body.payload) {
          throw new Error(body.error ?? "QUOTES_LOAD_FAILED");
        }
        if (!cancelled) setPayload(body.payload);
      })
      .catch((loadError) => {
        if (cancelled) return;
        const code = loadError instanceof Error ? loadError.message : "QUOTES_LOAD_FAILED";
        setError(
          code === "MODULE_FORBIDDEN"
            ? "Ton profil n’autorise pas la consultation des devis."
            : "Impossible de charger les devis de cette affaire.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const quotes = useMemo(
    () =>
      (payload?.quotes ?? [])
        .filter((quote) => quote.commercialCaseId === item.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [item.id, payload?.quotes],
  );

  const currentQuoteCount = useMemo(
    () => quotes.filter((quote) => quote.status !== "SUPERSEDED").length,
    [quotes],
  );
  const variantCount = useMemo(
    () => new Set(quotes.map((quote) => quote.variantName.trim().toLocaleLowerCase("fr-FR"))).size,
    [quotes],
  );

  return (
    <section className="commercialAffairQuotes commercialV2Section">
      <div className="commercialAffairQuotesHeading">
        <h3>
          <FileText size={15} /> Devis de l’affaire
        </h3>
        <div className="commercialAffairQuotesHeadingActions">
          <span>{quotes.length}</span>
          <Link
            className="commercialAffairQuoteCreate"
            href={`/devis/nouveau?affaire=${encodeURIComponent(item.id)}`}
          >
            <FilePlus2 size={13} /> Créer un devis
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="commercialAffairQuotesState">
          <RefreshCw size={14} /> Chargement des devis…
        </div>
      ) : error ? (
        <div className="commercialAffairQuotesState error">{error}</div>
      ) : quotes.length === 0 ? (
        <div className="commercialAffairQuotesState">
          Aucun devis créé pour cette affaire. Le premier sera automatiquement Base V1.
        </div>
      ) : (
        <>
          <div
            className="commercialAffairQuotesOverview"
            aria-label="Synthèse des devis de l’affaire"
          >
            <div>
              <strong>{currentQuoteCount}</strong>
              <span>
                proposition{currentQuoteCount > 1 ? "s" : ""} courante
                {currentQuoteCount > 1 ? "s" : ""}
              </span>
            </div>
            <div>
              <strong>{quotes.length}</strong>
              <span>
                version{quotes.length > 1 ? "s" : ""} conservée{quotes.length > 1 ? "s" : ""}
              </span>
            </div>
            <div>
              <strong>{variantCount}</strong>
              <span>variante{variantCount > 1 ? "s" : ""}</span>
            </div>
            <p>
              Pas de cumul contractuel à ce stade : les variantes et anciennes versions ne sont pas
              additionnées avant la sélection des devis réellement retenus.
            </p>
          </div>

          <div className="commercialAffairQuotesList">
            {quotes.map((quote) => {
              const displayStatus = commercialQuoteDisplayStatus(quote.status, quote.followUpDate);
              const summary = calculateCommercialQuoteSummary(quote);
              return (
                <button
                  type="button"
                  key={quote.id}
                  className="commercialAffairQuoteRow"
                  onDoubleClick={() => window.location.assign(quoteEditorHref(quote.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") window.location.assign(quoteEditorHref(quote.id));
                  }}
                  title="Double-clique pour ouvrir ce devis dans le module Devis"
                >
                  <div className="commercialAffairQuoteMain">
                    <FileText size={16} />
                    <div>
                      <strong>{quote.model.subject}</strong>
                      <span>
                        {quote.finalPdf
                          ? `${quote.finalPdf.quoteNumber} · `
                          : "Numéro à attribuer · "}
                        {quote.variantName} · V{quote.version} · {dateLabel(quote.model.issueDate)}
                      </span>
                    </div>
                  </div>

                  <div className="commercialAffairQuoteFigures" aria-label="Chiffres du devis">
                    <div>
                      <span>Total HT</span>
                      <strong>{moneyLabel(summary.totalHtCents)}</strong>
                    </div>
                    <div>
                      <span>Heures vendues</span>
                      <strong>{hoursLabel(summary.soldHours)}</strong>
                    </div>
                    <div>
                      <span>Déboursé prévu</span>
                      <strong>
                        {summary.plannedDisbursementCents === null
                          ? "À compléter"
                          : moneyLabel(summary.plannedDisbursementCents)}
                      </strong>
                    </div>
                  </div>

                  <div className="commercialAffairQuoteMeta">
                    {quote.followUpDate ? (
                      <small>Relance {dateLabel(quote.followUpDate)}</small>
                    ) : null}
                    <span className={`commercialAffairQuoteStatus ${statusTone(displayStatus)}`}>
                      {COMMERCIAL_QUOTE_STATUS_LABELS[displayStatus]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="commercialAffairQuotesCostNote">
            Déboursé prévu = coûts prévus du devis hors heures PAPOT BE, Atelier et Pose.
          </p>
        </>
      )}

      <p className="commercialAffairQuotesHint">
        Double-clique sur un devis pour l’ouvrir directement dans le module Devis.
      </p>

      <style jsx>{`
        .commercialAffairQuotes {
          grid-column: 1 / -1;
          padding: 11px;
          border: 1px solid #e3deea;
          border-radius: 9px;
          background: #fcfbfe;
        }
        .commercialAffairQuotesHeading,
        .commercialAffairQuoteRow,
        .commercialAffairQuoteMain,
        .commercialAffairQuoteMeta,
        .commercialAffairQuotesHeadingActions,
        .commercialAffairQuoteCreate {
          display: flex;
          align-items: center;
        }
        .commercialAffairQuotesHeading,
        .commercialAffairQuoteRow {
          justify-content: space-between;
          gap: 10px;
        }
        .commercialAffairQuotesHeading h3 {
          margin: 0;
        }
        .commercialAffairQuotesHeadingActions {
          gap: 7px;
        }
        .commercialAffairQuotesHeadingActions > span {
          padding: 2px 7px;
          border-radius: 999px;
          background: #eee9ff;
          color: #604dc4;
          font-size: 9px;
          font-weight: 800;
        }
        .commercialAffairQuoteCreate {
          gap: 5px;
          padding: 5px 8px;
          border: 1px solid #ddd5f4;
          border-radius: 7px;
          background: #fff;
          color: #604dc4;
          font-size: 9px;
          font-weight: 800;
          text-decoration: none;
        }
        .commercialAffairQuoteCreate:hover,
        .commercialAffairQuoteCreate:focus-visible {
          background: #f4f0ff;
        }
        .commercialAffairQuotesState {
          min-height: 58px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          color: #81798b;
          font-size: 10px;
        }
        .commercialAffairQuotesState.error {
          color: #9d4438;
        }
        .commercialAffairQuotesOverview {
          display: grid;
          grid-template-columns: repeat(3, minmax(90px, 1fr)) minmax(240px, 2fr);
          gap: 7px;
          margin: 8px 0;
        }
        .commercialAffairQuotesOverview > div,
        .commercialAffairQuotesOverview > p {
          margin: 0;
          padding: 8px 9px;
          border: 1px solid #ebe6f0;
          border-radius: 8px;
          background: #fff;
        }
        .commercialAffairQuotesOverview > div {
          display: grid;
          gap: 2px;
        }
        .commercialAffairQuotesOverview strong {
          font-size: 15px;
          color: #51449d;
          font-variant-numeric: tabular-nums;
        }
        .commercialAffairQuotesOverview span,
        .commercialAffairQuotesOverview p,
        .commercialAffairQuotesCostNote {
          color: #81798b;
          font-size: 8px;
        }
        .commercialAffairQuotesOverview p {
          display: flex;
          align-items: center;
          line-height: 1.4;
        }
        .commercialAffairQuotesList {
          display: grid;
          border: 1px solid #ebe6f0;
          border-radius: 8px;
          overflow: hidden;
          background: white;
        }
        .commercialAffairQuoteRow {
          width: 100%;
          min-height: 56px;
          padding: 9px 10px;
          border: 0;
          border-bottom: 1px solid #eeeaf2;
          border-radius: 0;
          background: white;
          color: inherit;
          text-align: left;
        }
        .commercialAffairQuoteRow:last-child {
          border-bottom: 0;
        }
        .commercialAffairQuoteRow:hover,
        .commercialAffairQuoteRow:focus-visible {
          background: #f8f5ff;
        }
        .commercialAffairQuoteMain,
        .commercialAffairQuoteMeta {
          gap: 8px;
        }
        .commercialAffairQuoteRow {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) minmax(270px, 1fr) auto;
        }
        .commercialAffairQuoteFigures {
          display: grid;
          grid-template-columns: repeat(3, minmax(78px, 1fr));
          gap: 6px;
        }
        .commercialAffairQuoteFigures > div {
          display: grid;
          gap: 2px;
          padding: 5px 7px;
          border-radius: 6px;
          background: #faf8fd;
        }
        .commercialAffairQuoteFigures span {
          color: #8b8490;
          font-size: 7px;
          font-weight: 750;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .commercialAffairQuoteFigures strong {
          font-size: 9px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .commercialAffairQuoteMain {
          min-width: 0;
        }
        .commercialAffairQuoteMain > :global(svg) {
          flex: 0 0 auto;
          color: #6f5dcc;
        }
        .commercialAffairQuoteMain > div {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .commercialAffairQuoteMain strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 10px;
        }
        .commercialAffairQuoteMain span,
        .commercialAffairQuoteMeta small,
        .commercialAffairQuotesHint {
          color: #8b8490;
          font-size: 8px;
        }
        .commercialAffairQuoteMeta {
          flex: 0 0 auto;
        }
        .commercialAffairQuoteStatus {
          padding: 3px 7px;
          border-radius: 999px;
          font-size: 8px;
          font-weight: 800;
        }
        .commercialAffairQuoteStatus.draft {
          background: #eee9fb;
          color: #6654be;
        }
        .commercialAffairQuoteStatus.sent {
          background: #eaf4ff;
          color: #3d6f9d;
        }
        .commercialAffairQuoteStatus.follow {
          background: #fff0e9;
          color: #a85c37;
        }
        .commercialAffairQuoteStatus.accepted {
          background: #e9f8ef;
          color: #3c7955;
        }
        .commercialAffairQuoteStatus.closed {
          background: #f0eef1;
          color: #77717c;
        }
        .commercialAffairQuotesHint {
          margin: 0;
        }
        .commercialAffairQuotesCostNote {
          margin: 6px 0 0;
          line-height: 1.4;
        }
        @media (max-width: 700px) {
          .commercialAffairQuotesHeading,
          .commercialAffairQuoteRow,
          .commercialAffairQuoteMeta {
            align-items: flex-start;
          }
          .commercialAffairQuotesHeading {
            flex-direction: column;
          }
          .commercialAffairQuotesOverview {
            grid-template-columns: repeat(3, 1fr);
          }
          .commercialAffairQuotesOverview > p {
            grid-column: 1 / -1;
          }
          .commercialAffairQuoteRow {
            grid-template-columns: 1fr;
          }
          .commercialAffairQuoteFigures {
            width: 100%;
          }
          .commercialAffairQuotesHeadingActions {
            width: 100%;
            justify-content: space-between;
          }
        }
      `}</style>
    </section>
  );
}
