"use client";

import { TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardSoldSummary } from "@/lib/dashboard/sold-summary";

const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function money(cents: number | null): string {
  return cents === null ? "À compléter" : euro.format(cents / 100);
}

export function DashboardSoldMarginStat() {
  const [snapshot, setSnapshot] = useState<DashboardSoldSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/desktop/dashboard/sold-summary", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 403) throw new Error("Accès réservé au pilotage global.");
        if (!response.ok) throw new Error("Indicateurs momentanément indisponibles.");
        const value = (await response.json()) as DashboardSoldSummary;
        if (!controller.signal.aborted) setSnapshot(value);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Indicateurs indisponibles.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <article className="dashboardStat dashboardStatBlue dashboardSoldStat">
      <span className="dashboardStatIcon">
        <TrendingUp size={20} aria-hidden="true" />
      </span>
      <div className="dashboardSoldBody">
        <strong className="dashboardSoldTitle">Vendu &amp; rentabilité</strong>
        {loading ? <small>Chargement…</small> : null}
        {error && !loading ? <small role="status">{error}</small> : null}
        {snapshot && !loading ? (
          <>
            <div className="dashboardSoldLine">
              <span>Année {snapshot.year}</span>
              <strong>{money(snapshot.yearly.soldCents)}</strong>
            </div>
            <div className="dashboardSoldLine">
              <span>Mois {snapshot.month.slice(5)}</span>
              <strong>{money(snapshot.monthly.soldCents)}</strong>
            </div>
            <div className="dashboardSoldLine">
              <span>Marge prévue {snapshot.year}</span>
              <strong>{money(snapshot.yearly.plannedMarginCents)}</strong>
            </div>
            {snapshot.yearly.incompleteCases > 0 ? (
              <small>{snapshot.yearly.incompleteCases} affaire(s) sans devis natif complet.</small>
            ) : null}
          </>
        ) : null}
        <small className="dashboardSoldWarning">
          Commandes confirmées HT, pas CA facturé. Marge réelle en attente des achats.
        </small>
      </div>
      <style jsx>{`
        .dashboardSoldStat {
          align-items: flex-start;
          gap: 10px;
        }
        .dashboardSoldBody {
          width: 100%;
          min-width: 0;
          display: grid;
          gap: 6px;
        }
        .dashboardSoldBody .dashboardSoldTitle {
          font-size: 12px;
          line-height: 1.3;
          color: #425578;
        }
        .dashboardSoldBody .dashboardSoldLine {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 4px;
          padding-top: 5px;
          border-top: 1px solid #e9e5f1;
        }
        .dashboardSoldBody .dashboardSoldLine span {
          margin: 0;
          color: #625c70;
          font-size: 10px;
        }
        .dashboardSoldBody .dashboardSoldLine strong {
          color: #344b79;
          font-size: 14px;
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
        }
        .dashboardSoldBody .dashboardSoldWarning {
          color: #767182;
          font-size: 9px;
          line-height: 1.4;
        }
      `}</style>
    </article>
  );
}
