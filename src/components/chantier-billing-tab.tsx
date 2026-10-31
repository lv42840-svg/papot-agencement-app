"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BillingPayload } from "@/lib/billing/domain";

const money = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export function ChantierBillingTab({ chantierId }: { chantierId: string }) {
  const [snapshot, setSnapshot] = useState<BillingPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/desktop/billing", { cache: "no-store" });
        const result = (await response.json()) as { payload?: BillingPayload; error?: string };
        if (!response.ok || !result.payload)
          throw new Error(result.error ?? "Chargement impossible");
        setSnapshot(result.payload);
        setError("");
      } catch {
        setError("Impossible d'afficher les projets de facture. Vérifie les droits Facturation.");
      }
    })();
  }, [chantierId]);

  const projects = (snapshot?.drafts ?? [])
    .filter((draft) => draft.chantierId === chantierId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <section style={{ display: "grid", gap: 15 }}>
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <h2>Factures du chantier</h2>
          <p>Projets enregistrés et historique interne, liés aux devis retenus du chantier.</p>
        </div>
        <Link
          className="primaryButton"
          href={`/facturation?chantierId=${encodeURIComponent(chantierId)}`}
        >
          Nouvelle facture
        </Link>
      </header>
      <p>
        <strong>Factures officiellement émises : non disponibles.</strong> PAPOT ne délivre encore
        ni numéro légal ni facture officielle sans le raccordement Pennylane. Les projets validés en
        interne ne sont pas des factures émises.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!error && !snapshot ? <p>Chargement des projets…</p> : null}
      {snapshot && (
        <>
          <h3>Projets de facture ({projects.length})</h3>
          {projects.length === 0 ? (
            <p>Aucun projet enregistré pour ce chantier.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                    <th style={{ padding: 8 }}>Date</th>
                    <th style={{ padding: 8 }}>Devis</th>
                    <th style={{ padding: 8 }}>Intitulé</th>
                    <th style={{ padding: 8 }}>Statut</th>
                    <th style={{ padding: 8, textAlign: "right" }}>HT</th>
                    <th style={{ padding: 8, textAlign: "right" }}>TTC</th>
                    <th style={{ padding: 8 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((draft) => (
                    <tr key={draft.id} style={{ borderBottom: "1px solid #ece8f0" }}>
                      <td style={{ padding: 8 }}>
                        {new Date(draft.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 8 }}>{draft.quoteLabel}</td>
                      <td style={{ padding: 8 }}>{draft.label}</td>
                      <td style={{ padding: 8 }}>
                        {draft.status === "APPROVED" ? "Validé en interne" : "À préparer"}
                        <div style={{ fontSize: 11 }}>Non émis</div>
                      </td>
                      <td style={{ padding: 8, textAlign: "right" }}>
                        {money(draft.amountHtCents)}
                      </td>
                      <td style={{ padding: 8, textAlign: "right" }}>
                        {money(draft.totalTtcCents)}
                      </td>
                      <td style={{ padding: 8 }}>
                        <Link className="secondaryButton" href={`/facturation/${draft.id}`}>
                          {draft.status === "APPROVED" ? "Consulter" : "Ouvrir"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
