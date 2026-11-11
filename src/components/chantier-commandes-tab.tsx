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
  const [contenu, setPayload] = useState<PurchaseOrdersPayload | null>(null);
  const [chargement, setLoading] = useState(true);
  const [erreur, setError] = useState("");
  const [recherche, setSearch] = useState("");
  const [statut, setStatus] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const reponse = await fetch("/api/desktop/purchases", { cache: "no-store" });
      if (!reponse.ok) throw new Error("PURCHASES_UNAVAILABLE");
      const resultat = (await reponse.json()) as { payload?: PurchaseOrdersPayload };
      if (!resultat.payload) throw new Error("PURCHASES_UNAVAILABLE");
      setPayload(resultat.payload);
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
        contenu ?? { schemaVersion: 1, nextNumber: 1, orders: [] },
        chantierId,
      ).sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt)),
    [contenu, chantierId],
  );

  const filtered = history.filter(({ order: commande, state: etat }) => {
    if (statut !== "ALL" && statut !== etat) return false;
    const needle = recherche.trim().toLocaleLowerCase("fr-FR");
    if (!needle) return true;
    return [
      commande.reference,
      commande.supplierName,
      commande.description,
      ...commande.lines.map((ligne) => ligne.description),
    ]
      .join(" ")
      .toLocaleLowerCase("fr-FR")
      .includes(needle);
  });

  const committed = history.filter(({ state: etat }) => etat === "COMMITTED");
  const committedHtCents = committed.reduce((somme, element) => somme + element.amountHtCents, 0);
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
            Bons de commande rapides et détaillés, affectés à ce chantier. Les commandes partagées
            n&apos;affichent ici que la part chantier, hors SAV et frais généraux.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            className="secondaryButton"
            type="button"
            disabled={chargement}
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
      {erreur ? <p role="alert">{erreur}</p> : null}
      {chargement ? <p>Chargement des commandes…</p> : null}
      {!chargement && contenu && (
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
              value={recherche}
              onChange={(evenement) => setSearch(evenement.target.value)}
              placeholder="Référence, fournisseur, article…"
              style={{ minWidth: 220, flex: "2 1 220px" }}
            />
            <select
              aria-label="Filtrer les commandes par statut"
              value={statut}
              onChange={(evenement) => setStatus(evenement.target.value)}
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
                  {filtered.map(({ order: commande, amountHtCents, state: etat, removedAt }) => (
                    <tr key={commande.id} style={{ borderBottom: "1px solid #ece8f0" }}>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                        <strong>{commande.reference}</strong>
                      </td>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                        {new Date(commande.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 8 }}>{commande.supplierName}</td>
                      <td style={{ padding: 8 }}>
                        {commande.mode === "QUICK" ? "Rapide" : "Détaillé"}
                      </td>
                      <td style={{ padding: 8 }}>
                        {statusLabel[etat]}
                        {removedAt ? (
                          <div style={{ fontSize: 11 }}>
                            {new Date(removedAt).toLocaleDateString("fr-FR")}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                        <strong>{euros(amountHtCents)}</strong>
                        {commande.allocations && commande.allocations.length > 1 ? (
                          <div style={{ fontSize: 11 }}>
                            BC global : {euros(commande.amountHtCents)}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: 8 }}>À raccorder (Pennylane)</td>
                      <td style={{ padding: 8 }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          {commande.mode === "DETAILED" ? (
                            <a
                              className="secondaryButton"
                              href={`/api/desktop/purchases/${encodeURIComponent(commande.id)}/pdf`}
                            >
                              Télécharger le PDF
                            </a>
                          ) : null}
                          {etat === "COMMITTED" && !commande.removedAllocations?.length ? (
                            <Link
                              className="secondaryButton"
                              href={`/achats/${encodeURIComponent(commande.id)}/modifier`}
                            >
                              Modifier le BC
                            </Link>
                          ) : null}
                          <details>
                            <summary>Voir le BC</summary>
                            <div style={{ minWidth: 260, paddingTop: 7 }}>
                              {commande.description ? <p>{commande.description}</p> : null}
                              {commande.mode === "DETAILED" ? (
                                <ul>
                                  {commande.lines.map((ligne) => (
                                    <li key={ligne.id}>
                                      {ligne.description} : {ligne.quantity} {ligne.unit} ×{" "}
                                      {euros(ligne.unitPriceHtCents)} ={" "}
                                      {euros(Math.round(ligne.quantity * ligne.unitPriceHtCents))}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p>BC rapide, montant global HT réparti par destination.</p>
                              )}
                              {commande.allocations && commande.allocations.length > 1 ? (
                                <p>
                                  {commande.allocations.length} destinations dans cette commande.
                                </p>
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
