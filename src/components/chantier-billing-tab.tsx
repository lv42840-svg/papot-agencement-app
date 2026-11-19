"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BillingPayload } from "@/lib/billing/domain";
import type { ChantierBillingMarket } from "@/lib/billing/chantier-market";

const money = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function visaLabel(payload: BillingPayload, draftId: string, chantierId: string): string {
  const latest = (payload.visaVersions ?? []).filter((item) => item.draftId === draftId).at(-1);
  if (!latest) {
    return payload.visaRequirements?.some(
      (rule) => rule.chantierId === chantierId && rule.required,
    )
      ? "Visa obligatoire, non présenté"
      : "Facultatif, non présenté";
  }
  const labels = {
    SUBMITTED: "En attente de réponse",
    ACCEPTED: "Accepté",
    PARTIAL: "Accepté partiellement",
    REFUSED: "Refusé",
    WITHDRAWN: "Retiré",
  };
  return `V${latest.version} · ${labels[latest.status]}`;
}

export function ChantierBillingTab({ chantierId }: { chantierId: string }) {
  const [snapshot, setSnapshot] = useState<BillingPayload | null>(null);
  const [error, setError] = useState("");
  const [market, setMarket] = useState<ChantierBillingMarket | null>(null);
  const [marketError, setMarketError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/desktop/billing", { cache: "no-store" });
        const result = (await response.json()) as { payload?: BillingPayload; error?: string };
        if (!response.ok || !result.payload)
          throw new Error(result.error ?? "Chargement impossible");
        setSnapshot(result.payload);
        setError("");
        const marketResponse = await fetch("/api/desktop/billing/markets", {
          cache: "no-store",
        });
        if (marketResponse.ok) {
          const marketResult = (await marketResponse.json()) as {
            markets: ChantierBillingMarket[];
          };
          setMarket(marketResult.markets.find((item) => item.chantierId === chantierId) ?? null);
          setMarketError("");
        } else {
          setMarketError("Aperçu du marché indisponible.");
        }
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
          <h2>Facturation du chantier</h2>
          <p>Marché, projets et validations provisoires, sans émission officielle.</p>
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
      {marketError ? <p role="status">{marketError}</p> : null}
      {market && (
        <section className="invoiceCard">
          <h3>Marché global du chantier : aperçu</h3>
          <p>
            <strong>{market.quoteCount} devis retenu(s)</strong> · Marché :{" "}
            <strong>{money(market.contractHtCents)} HT</strong>
          </p>
          <p>
            Projets préparés, non émis : {money(market.preparedHtCents)} HT · Reste à préparer :{" "}
            {money(market.remainingToPrepareHtCents)} HT.
          </p>
          {market.requiresMarketEntry ? (
            <p role="status">
              Ce chantier n&apos;a pas encore de marché. Ouvre Facturation pour enregistrer un
              marché simplifié sans devis, sans inventer de montant.
            </p>
          ) : (
            <details>
              <summary>Voir les devis composant le marché</summary>
              <ul>
                {market.quotes.map((quote) => (
                  <li key={quote.quoteId}>
                    {quote.label} : {money(quote.amountHtCents)} HT
                  </li>
                ))}
              </ul>
            </details>
          )}
          {market.quoteCount > 1 && (
            <p>Ce marché regroupe plusieurs devis et permet un projet unique depuis Facturation.</p>
          )}
          {market.pendingExtraCount > 0 && (
            <p role="status">
              {market.pendingExtraCount} supplément(s) en attente d&apos;accord, soit{" "}
              {money(market.pendingExtraHtCents)} HT hors marché confirmé.
            </p>
          )}
          {market.preparationExceedsContract && (
            <p role="alert">
              Les projets préparés dépassent le marché connu : vérification nécessaire.
            </p>
          )}
        </section>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {!error && !snapshot ? <p>Chargement des projets…</p> : null}
      {snapshot && (
        <>
          <h3>Projets de facture ({projects.length})</h3>
          {projects.length === 0 ? (
            <p>Aucun projet enregistré pour ce chantier.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                    <th style={{ padding: 8 }}>Date</th>
                    <th style={{ padding: 8 }}>Marché</th>
                    <th style={{ padding: 8 }}>Intitulé</th>
                    <th style={{ padding: 8 }}>Statut</th>
                    <th style={{ padding: 8 }}>Visa extérieur</th>
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
                      <td style={{ padding: 8 }}>
                        {visaLabel(snapshot, draft.id, chantierId)}
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
