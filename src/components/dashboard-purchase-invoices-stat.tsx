"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { PendingPurchaseInvoiceSummary } from "@/lib/pennylane/purchase-invoice-store";

export function DashboardPurchaseInvoicesStat() {
  const [summary, setSummary] = useState<PendingPurchaseInvoiceSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/desktop/dashboard/purchase-invoices-summary", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("SUMMARY_UNAVAILABLE");
        return response.json() as Promise<PendingPurchaseInvoiceSummary>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setSummary(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <Link
      className="dashboardStat dashboardStatGold dashboardStatLink"
      href="/achats/factures?tab=pending"
    >
      <span className="dashboardStatIcon">
        <ClipboardCheck size={20} aria-hidden="true" />
      </span>
      <div>
        <strong>{summary?.imported ? summary.pending : "—"}</strong>
        <span>Factures à valider</span>
        <small>
          {error
            ? "Compteur indisponible"
            : !summary
              ? "Chargement…"
              : !summary.imported
                ? "Pennylane non importé"
                : summary.truncated
                  ? "parmi les 500 dernières"
                  : "affectations PAPOT en attente"}
        </small>
      </div>
    </Link>
  );
}
