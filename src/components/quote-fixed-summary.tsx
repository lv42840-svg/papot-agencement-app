"use client";

import type { NativeQuoteRecord } from "@/lib/quotes/store";
import { calculateQuoteEconomicSummary } from "@/lib/quotes/summary";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatPercent(value: number | null): string {
  return value === null ? "n/c" : `${percentFormatter.format(value)} %`;
}

export function QuoteFixedSummary({ quote }: { quote: NativeQuoteRecord }) {
  const summary = calculateQuoteEconomicSummary(quote.model.items);
  const marginMissing = summary.marginAmountCents === null;
  const marginNegative = !marginMissing && summary.marginAmountCents < 0;

  return (
    <aside className="quoteFixedSummary" aria-label="Synthèse économique du devis" aria-live="polite">
      <div className="quoteSummaryMetric">
        <span>Total HT</span>
        <strong>{formatMoney(summary.totalSaleCents)}</strong>
      </div>
      <div
        className={`quoteSummaryMetric${marginMissing ? " isMissing" : marginNegative ? " isNegative" : ""}`}
      >
        <span>Marge globale prévue</span>
        {summary.marginAmountCents === null ? (
          <strong>À renseigner</strong>
        ) : (
          <strong>
            {formatMoney(summary.marginAmountCents)}
            <small>{formatPercent(summary.marginPercent)}</small>
          </strong>
        )}
      </div>

      <style jsx>{`
        .quoteFixedSummary {
          position: fixed;
          right: 24px;
          bottom: 20px;
          z-index: 50;
          display: flex;
          align-items: stretch;
          gap: 8px;
          padding: 8px;
          border: 1px solid #d7cfed;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 12px 34px rgba(65, 50, 110, 0.18);
          backdrop-filter: blur(10px);
          pointer-events: none;
        }
        .quoteSummaryMetric {
          min-width: 165px;
          display: grid;
          align-content: center;
          gap: 3px;
          padding: 7px 10px;
          border-radius: 8px;
          background: #faf8ff;
        }
        .quoteSummaryMetric > span {
          color: var(--muted);
          font-size: 9px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.045em;
        }
        .quoteSummaryMetric > strong {
          color: var(--text);
          font-size: 15px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .quoteSummaryMetric > strong small {
          margin-left: 7px;
          color: #31724b;
          font-size: 11px;
          font-weight: 850;
        }
        .quoteSummaryMetric.isNegative > strong,
        .quoteSummaryMetric.isNegative > strong small {
          color: #a53d3d;
        }
        .quoteSummaryMetric.isMissing > strong {
          color: var(--muted);
          font-size: 12px;
        }
        @media (max-width: 700px) {
          .quoteFixedSummary {
            right: 12px;
            bottom: 12px;
            left: 12px;
          }
          .quoteSummaryMetric {
            min-width: 0;
            flex: 1 1 0;
          }
        }
      `}</style>
    </aside>
  );
}
