"use client";

import { CheckCircle2, FileText, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommercialCase } from "@/lib/commercial/domain";
import {
  COMMERCIAL_QUOTE_STATUS_LABELS,
  commercialQuoteDisplayStatus,
} from "@/lib/commercial/quote-follow-up";
import {
  calculateCommercialContractSummary,
  calculateCommercialQuoteSummary,
} from "@/lib/quotes/commercial-summary";
import { quoteCanBeRetained } from "@/lib/quotes/retention";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

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

function moneyLabel(cents: number | null): string {
  return cents === null ? "À compléter" : moneyFormatter.format(cents / 100);
}

function hoursLabel(hours: number): string {
  return `${hoursFormatter.format(hours)} h`;
}

function quoteIdentity(quote: NativeQuoteRecord): string {
  return quote.finalPdf?.quoteNumber ?? "Sans numéro définitif";
}

export function CommercialConfirmationDialog({
  item,
  plannedInstallDate,
  busy,
  onCancel,
  onConfirm,
}: {
  item: CommercialCase;
  plannedInstallDate: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (retainedQuoteIds: string[], confirmWithoutQuote: boolean) => Promise<boolean>;
}) {
  const [payload, setPayload] = useState<NativeQuotesPayload | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(item.retainedQuoteIds);
  const [confirmWithoutQuote, setConfirmWithoutQuote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    void fetch("/api/desktop/quotes", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as QuotesApiResponse;
        if (!response.ok || !body.payload) throw new Error(body.error ?? "QUOTES_LOAD_FAILED");
        if (cancelled) return;
        setPayload(body.payload);

        const caseQuotes = body.payload.quotes.filter(
          (quote) => quote.commercialCaseId === item.id,
        );
        const selectable = caseQuotes.filter(quoteCanBeRetained);
        if (item.retainedQuoteIds.length === 0 && selectable.length === 1) {
          setSelectedIds([selectable[0].id]);
        }
        if (selectable.length === 0) setConfirmWithoutQuote(true);
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de charger les devis de cette affaire.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.retainedQuoteIds]);

  const quotes = useMemo(
    () =>
      (payload?.quotes ?? [])
        .filter((quote) => quote.commercialCaseId === item.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [item.id, payload?.quotes],
  );
  const selectableCount = quotes.filter(quoteCanBeRetained).length;
  const contract = useMemo(
    () => calculateCommercialContractSummary(quotes, selectedIds),
    [quotes, selectedIds],
  );
  const canSubmit =
    !loading &&
    !error &&
    !!plannedInstallDate &&
    ((selectableCount > 0 && selectedIds.length > 0) ||
      (selectableCount === 0 && confirmWithoutQuote));

  function toggleQuote(quoteId: string) {
    setSelectedIds((current) =>
      current.includes(quoteId)
        ? current.filter((candidate) => candidate !== quoteId)
        : [...current, quoteId],
    );
  }

  async function submit() {
    if (!canSubmit || submitting || busy) return;
    setSubmitting(true);
    const confirmed = await onConfirm(selectedIds, selectableCount === 0 && confirmWithoutQuote);
    if (!confirmed) setSubmitting(false);
  }

  return (
    <div className="commercialConfirmBackdrop" role="presentation">
      <section
        className="commercialConfirmDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commercialConfirmTitle"
      >
        <header>
          <div>
            <span>Passage en affaire confirmée</span>
            <h2 id="commercialConfirmTitle">Quels devis le client a-t-il retenus ?</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={submitting}>
            <X size={17} />
          </button>
        </header>

        <p className="commercialConfirmIntro">
          Tu peux en retenir plusieurs. Les autres restent dans l’historique et ne seront pas
          comptés dans le contrat.
        </p>

        {loading ? (
          <div className="commercialConfirmState">
            <RefreshCw size={15} /> Chargement des devis…
          </div>
        ) : error ? (
          <div className="commercialConfirmState error">{error}</div>
        ) : quotes.length > 0 ? (
          <div className="commercialConfirmQuotes">
            {quotes.map((quote) => {
              const selectable = quoteCanBeRetained(quote);
              const checked = selectedIds.includes(quote.id);
              const summary = calculateCommercialQuoteSummary(quote);
              const displayStatus = commercialQuoteDisplayStatus(quote.status, quote.followUpDate);

              return (
                <label
                  key={quote.id}
                  className={`commercialConfirmQuote${checked ? " selected" : ""}${
                    selectable ? "" : " disabled"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!selectable || submitting}
                    onChange={() => toggleQuote(quote.id)}
                  />
                  <FileText size={17} />
                  <div className="commercialConfirmQuoteIdentity">
                    <strong>{quote.model.subject}</strong>
                    <span>
                      {quoteIdentity(quote)} · {quote.variantName} · V{quote.version}
                    </span>
                    <small>
                      {selectable
                        ? COMMERCIAL_QUOTE_STATUS_LABELS[displayStatus]
                        : quote.status === "DRAFT"
                          ? "Brouillon non figé"
                          : "Non sélectionnable"}
                    </small>
                  </div>
                  <div className="commercialConfirmQuoteFigures">
                    <span>{moneyLabel(summary.totalHtCents)}</span>
                    <span>{hoursLabel(summary.soldHours)}</span>
                    <span>{moneyLabel(summary.plannedDisbursementCents)}</span>
                  </div>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="commercialConfirmState">Aucun devis natif lié à cette affaire.</div>
        )}

        {selectableCount === 0 && !loading && !error ? (
          <label className="commercialConfirmWithoutQuote">
            <input
              type="checkbox"
              checked={confirmWithoutQuote}
              onChange={(event) => setConfirmWithoutQuote(event.target.checked)}
              disabled={submitting}
            />
            <span>
              Confirmer explicitement l’affaire sans devis retenu. Le cahier des charges autorise ce
              cas lorsqu’un chantier démarre sans devis.
            </span>
          </label>
        ) : null}

        {selectedIds.length > 0 ? (
          <div className="commercialConfirmContract">
            <div>
              <span>Devis retenus</span>
              <strong>{contract.quoteCount}</strong>
            </div>
            <div>
              <span>CA HT vendu</span>
              <strong>{moneyLabel(contract.totalHtCents)}</strong>
            </div>
            <div>
              <span>Heures vendues</span>
              <strong>{hoursLabel(contract.soldHours)}</strong>
            </div>
            <div>
              <span>Déboursé prévu</span>
              <strong>{moneyLabel(contract.plannedDisbursementCents)}</strong>
            </div>
            <div>
              <span>Marge prévue</span>
              <strong>{moneyLabel(contract.plannedMarginCents)}</strong>
            </div>
          </div>
        ) : selectableCount > 0 ? (
          <div className="commercialConfirmWarning">
            Sélectionne au moins un devis retenu avant de confirmer l’affaire.
          </div>
        ) : null}

        <footer>
          <span>Pose prévue : {plannedInstallDate || "date manquante"}</span>
          <div>
            <button
              type="button"
              className="secondaryButton"
              onClick={onCancel}
              disabled={submitting}
            >
              Annuler
            </button>
            <button
              type="button"
              className="primaryButton"
              disabled={!canSubmit || submitting || busy}
              onClick={() => void submit()}
            >
              <CheckCircle2 size={15} />
              {submitting ? "Confirmation…" : "Confirmer l’affaire"}
            </button>
          </div>
        </footer>

        <style jsx>{`
          .commercialConfirmBackdrop {
            position: fixed;
            inset: 0;
            z-index: 120;
            display: grid;
            place-items: center;
            padding: 22px;
            background: rgba(29, 24, 38, 0.42);
            backdrop-filter: blur(4px);
          }
          .commercialConfirmDialog {
            width: min(940px, 100%);
            max-height: min(820px, calc(100vh - 44px));
            display: grid;
            gap: 12px;
            overflow: auto;
            padding: 18px;
            border: 1px solid #d9d0ee;
            border-radius: 16px;
            background: #fff;
            box-shadow: 0 26px 70px rgba(42, 31, 65, 0.24);
          }
          header,
          footer,
          footer > div,
          .commercialConfirmQuote,
          .commercialConfirmWithoutQuote {
            display: flex;
            align-items: center;
          }
          header,
          footer {
            justify-content: space-between;
            gap: 14px;
          }
          header span {
            color: #756b82;
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          header h2 {
            margin: 3px 0 0;
            font-size: 20px;
          }
          header button {
            border: 0;
            background: transparent;
          }
          .commercialConfirmIntro {
            margin: 0;
            color: #746d79;
            font-size: 11px;
          }
          .commercialConfirmState,
          .commercialConfirmWarning {
            min-height: 56px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px;
            border-radius: 9px;
            background: #f8f6fb;
            color: #746d79;
            font-size: 10px;
          }
          .commercialConfirmState.error {
            color: #9d4438;
          }
          .commercialConfirmQuotes {
            display: grid;
            gap: 7px;
          }
          .commercialConfirmQuote {
            display: grid;
            grid-template-columns: auto auto minmax(220px, 1fr) auto;
            gap: 10px;
            padding: 10px;
            border: 1px solid #e6e1eb;
            border-radius: 10px;
            background: #fff;
          }
          .commercialConfirmQuote.selected {
            border-color: #8f7bd8;
            background: #f8f5ff;
          }
          .commercialConfirmQuote.disabled {
            opacity: 0.58;
          }
          .commercialConfirmQuote > :global(svg) {
            color: #6f5dcc;
          }
          .commercialConfirmQuoteIdentity {
            min-width: 0;
            display: grid;
            gap: 2px;
          }
          .commercialConfirmQuoteIdentity strong {
            font-size: 11px;
          }
          .commercialConfirmQuoteIdentity span,
          .commercialConfirmQuoteIdentity small {
            color: #7e7686;
            font-size: 9px;
          }
          .commercialConfirmQuoteFigures {
            display: grid;
            grid-template-columns: repeat(3, minmax(80px, 1fr));
            gap: 7px;
            font-size: 9px;
            font-weight: 800;
            font-variant-numeric: tabular-nums;
          }
          .commercialConfirmQuoteFigures span {
            padding: 6px 8px;
            border-radius: 6px;
            background: #f8f6fb;
            white-space: nowrap;
          }
          .commercialConfirmWithoutQuote {
            gap: 9px;
            padding: 10px;
            border: 1px solid #e5dfeb;
            border-radius: 9px;
            background: #fbfafc;
            font-size: 10px;
          }
          .commercialConfirmContract {
            display: grid;
            grid-template-columns: repeat(5, minmax(110px, 1fr));
            gap: 7px;
            padding: 10px;
            border: 1px solid #d9d0ee;
            border-radius: 10px;
            background: #f8f5ff;
          }
          .commercialConfirmContract > div {
            display: grid;
            gap: 3px;
          }
          .commercialConfirmContract span {
            color: #756b82;
            font-size: 8px;
            font-weight: 800;
            text-transform: uppercase;
          }
          .commercialConfirmContract strong {
            font-size: 13px;
            font-variant-numeric: tabular-nums;
          }
          footer {
            padding-top: 3px;
            color: #746d79;
            font-size: 9px;
          }
          footer > div {
            gap: 8px;
          }
          @media (max-width: 760px) {
            .commercialConfirmBackdrop {
              padding: 8px;
            }
            .commercialConfirmDialog {
              max-height: calc(100vh - 16px);
            }
            .commercialConfirmQuote {
              grid-template-columns: auto auto 1fr;
            }
            .commercialConfirmQuoteFigures {
              grid-column: 1 / -1;
            }
            .commercialConfirmContract {
              grid-template-columns: repeat(2, 1fr);
            }
            footer {
              align-items: stretch;
              flex-direction: column;
            }
            footer > div {
              justify-content: flex-end;
            }
          }
        `}</style>
      </section>
    </div>
  );
}
