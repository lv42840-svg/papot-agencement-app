"use client";

import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { IssuedInvoiceSummary } from "@/lib/billing/issued-summary";

const euros = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const amount = (value: number | null) =>
  value === null ? "Non disponible" : euros.format(value / 100);

export function DashboardInvoicedStat() {
  const [summary, setSummary] = useState<IssuedInvoiceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/desktop/dashboard/invoiced-summary", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 403) throw new Error("Accès Pilotage et Facturation requis.");
        if (!response.ok) throw new Error("Chiffre d'affaires indisponible.");
        const result = (await response.json()) as IssuedInvoiceSummary;
        if (!controller.signal.aborted) setSummary(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Facturation indisponible.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <article className="dashboardStat dashboardStatBlue dashboardInvoicedStat">
      <span className="dashboardStatIcon">
        <FileCheck2 size={20} aria-hidden="true" />
      </span>
      <div className="dashboardInvoicedBody">
        <strong className="dashboardInvoicedTitle">Chiffre d&apos;affaires facturé HT</strong>
        {loading ? <small>Chargement…</small> : null}
        {error ? <small role="status">{error}</small> : null}
        {summary ? (
          <>
            <div className="dashboardInvoicedLine">
              <span>Mois {summary.month}</span>
              <strong>{amount(summary.monthly.amountHtCents)}</strong>
            </div>
            <div className="dashboardInvoicedLine">
              <span>Année {summary.year}</span>
              <strong>{amount(summary.yearly.amountHtCents)}</strong>
            </div>
            <div className="dashboardInvoicedLine">
              <span>Marge réelle du mois</span>
              <strong>Non disponible</strong>
            </div>
            {!summary.connected ? (
              <small>
                Pennylane non raccordé : aucune facture officielle n&apos;est encore disponible. Les
                devis acceptés et projets de factures ne sont pas comptés dans le CA.
              </small>
            ) : null}
            <Link href="/facturation?tab=FOLLOWUP" className="secondaryButton">
              Devis acceptés à suivre
            </Link>
          </>
        ) : null}
      </div>
      <style jsx>{`
        .dashboardInvoicedStat {
          align-items: flex-start;
          gap: 10px;
        }
        .dashboardInvoicedBody {
          width: 100%;
          min-width: 0;
          display: grid;
          gap: 8px;
        }
        .dashboardInvoicedTitle {
          font-size: 12px;
          color: #425578;
        }
        .dashboardInvoicedLine {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 4px;
          padding-top: 5px;
          border-top: 1px solid #e9e5f1;
        }
        .dashboardInvoicedLine span {
          font-size: 10px;
          color: #625c70;
        }
        .dashboardInvoicedLine strong {
          font-size: 14px;
          color: #344b79;
          font-variant-numeric: tabular-nums;
        }
        .dashboardInvoicedBody small {
          font-size: 10px;
          line-height: 1.4;
          color: #767182;
        }
      `}</style>
    </article>
  );
}
