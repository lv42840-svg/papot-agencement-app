"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  purchaseOrderHistoryForChantier,
  type PurchaseOrdersPayload,
} from "@/lib/purchases/domain";

const euros = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const statusLabel = {
  COMMITTED: "Engagé",
  REMOVED: "Retiré à la clôture",
  CANCELLED: "Annulé",
} as const;

export function ChantierCommandesTab({ chantierId }: { chantierId: string }) {
  const [payload, setPayload] = useState<PurchaseOrdersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/purchases", { cache: "no-store" });
      if (!response.ok) throw new Error("PURCHASES_UNAVAILABLE");
      const result = (await response.json()) as { payload?: PurchaseOrdersPayload };
      if (!result.payload) throw new Error("PURCHASES_UNAVAILABLE");
      setPayload(result.payload);
    } catch {
      setError("Impossible de charger les bons de commande. Vérifie tes droits de lecture Achats.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const history = useMemo(
    () =>
      purchaseOrderHistoryForChantier(
        payload ?? { schemaVersion: 1, nextNumber: 1, orders: [] },
        chantierId,
      ).sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt)),
    [payload, chantierId],
  );

  const filtered = history.filter(({ order, state }) => {
    if (status !== "ALL" && status !== state) return false;
    const needle = search.trim().toLocaleLowerCase("fr-FR");
    if (!needle) return true;
    return [
      order.reference,
      order.supplierName,
      order.description,
      ...order.lines.map((line) => line.description),
    ]
      .join(" ")
      .toLocaleLowerCase("fr-FR")
      .includes(needle);
  });

  const committed = history.filter(({ state }) => state === "COMMITTED");
  const committedHtCents = committed.reduce((sum, item) => sum + item.amountHtCents, 0);
  const actions = `/achats?chantierId=${encodeURIComponent(chantierId)}`;

  return (
    <section style={{ display: "grid", gap: 15 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2>Commandes du chantier</h2>
          <p>
            Bons de commande rapides et détaillés, affectés à ce chantier. Les BC multi-chantiers
            n&apos;affichent ici que leur part.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            className="secondaryButton"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            Actualiser
          </button>
          <Link className="secondaryButton" href={actions}>
            Voir dans Achats
          </Link>
          <Link className="primaryButton" href={actions}>
            Nouveau BC
          </Link>
        </div>
      </header>
      <p>
        <strong>Facture fournisseur :</strong> rapprochement Pennylane à venir. Aucun lien ni statut
        comptable n&apos;est encore disponible dans PAPOT.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p>Chargement des commandes…</p> : null}
      {!loading && payload && (
        <>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div>
              <strong>{committed.length}</strong> BC avec engagement actif
            </div>
            <div>
              <strong>{euros(committedHtCents)}</strong> HT engagés sur ce chantier
            </div>
            <div>
              <strong>{history.length}</strong> BC dans l&apos;historique
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              aria-label="Rechercher les commandes du chantier"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Référence, fournisseur, article…"
              style={{ minWidth: 220, flex: "2 1 220px" }}
            />
            <select
              aria-label="Filtrer les commandes par statut"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              style={{ flex: "1 1 170px" }}
            >
              <option value="ALL">Tous les statuts</option>
              <option value="COMMITTED">Engagés</option>
              <option value="REMOVED">Retirés à la clôture</option>
              <option value="CANCELLED">Annulés</option>
            </select>
          </div>
          {history.length === 0 ? (
            <p>Aucun bon de commande enregistré sur ce chantier.</p>
          ) : filtered.length === 0 ? (
            <p>Aucune commande correspondant aux filtres.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                    <th style={{ padding: 8 }}>BC</th>
                    <th style={{ padding: 8 }}>Date</th>
                    <th style={{ padding: 8 }}>Fournisseur</th>
                    <th style={{ padding: 8 }}>Type</th>
                    <th style={{ padding: 8 }}>Statut</th>
                    <th style={{ padding: 8, textAlign: "right" }}>HT chantier</th>
                    <th style={{ padding: 8 }}>Facture fournisseur</th>
                    <th style={{ padding: 8 }}>Document / détail</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ order, amountHtCents, state, removedAt }) => (
                    <tr key={order.id} style={{ borderBottom: "1px solid #ece8f0" }}>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                        <strong>{order.reference}</strong>
                      </td>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                        {new Date(order.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 8 }}>{order.supplierName}</td>
                      <td style={{ padding: 8 }}>
                        {order.mode === "QUICK" ? "Rapide" : "Détaillé"}
                      </td>
                      <td style={{ padding: 8 }}>
                        {statusLabel[state]}
                        {removedAt ? (
                          <div style={{ fontSize: 11 }}>
                            {new Date(removedAt).toLocaleDateString("fr-FR")}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                        <strong>{euros(amountHtCents)}</strong>
                        {order.allocations && order.allocations.length > 1 ? (
                          <div style={{ fontSize: 11 }}>
                            BC global : {euros(order.amountHtCents)}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: 8 }}>À raccorder (Pennylane)</td>
                      <td style={{ padding: 8 }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          {order.mode === "DETAILED" ? (
                            <a
                              className="secondaryButton"
                              href={`/api/desktop/purchases/${encodeURIComponent(order.id)}/pdf`}
                            >
                              Télécharger le PDF
                            </a>
                          ) : null}
                          {state === "COMMITTED" && !order.removedAllocations?.length ? (
                            <Link
                              className="secondaryButton"
                              href={`/achats/${encodeURIComponent(order.id)}/modifier`}
                            >
                              Modifier le BC
                            </Link>
                          ) : null}
                          <details>
                            <summary>Voir le BC</summary>
                            <div style={{ minWidth: 260, paddingTop: 7 }}>
                              {order.description ? <p>{order.description}</p> : null}
                              {order.mode === "DETAILED" ? (
                                <ul>
                                  {order.lines.map((line) => (
                                    <li key={line.id}>
                                      {line.description} : {line.quantity} {line.unit} ×{" "}
                                      {euros(line.unitPriceHtCents)} ={" "}
                                      {euros(Math.round(line.quantity * line.unitPriceHtCents))}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p>BC rapide, montant global HT réparti par chantier.</p>
                              )}
                              {order.allocations && order.allocations.length > 1 ? (
                                <p>Commande partagée entre {order.allocations.length} chantiers.</p>
                              ) : null}
                            </div>
                          </details>
                        </div>
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
