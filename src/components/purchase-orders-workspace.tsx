"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PurchaseOrderInput,
  PurchaseOrderLine,
  PurchaseOrdersPayload,
} from "@/lib/purchases/domain";
import {
  committedPurchaseTotal,
  committedPurchaseDestinationTotal,
  committedPurchasesByDestination,
  purchaseAllocationFromSelection,
  purchaseDestinationKey,
} from "@/lib/purchases/domain";

type Site = { id: string; name: string; clientName: string; status: string };
type Snapshot = {
  payload: PurchaseOrdersPayload;
  chantiers: Site[];
  canWrite: boolean;
  error?: string;
};
type QuickAllocation = { id: string; chantierId: string; amount: string };
const newAllocation = (chantierId = ""): QuickAllocation => ({
  id: crypto.randomUUID(),
  chantierId,
  amount: "",
});
type EditableLine = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};
const euro = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const newLine = (): EditableLine => ({
  id: crypto.randomUUID(),
  description: "",
  quantity: "1",
  unit: "u",
  unitPrice: "",
});
function moneyCents(raw: string): number | null {
  const valeur = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(valeur)) return null;
  const cents = Math.round(Number(valeur) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000_000 ? cents : null;
}
function positiveQuantity(raw: string): number | null {
  const valeur = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(valeur)) return null;
  const n = Number(valeur);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
}
const messageFor = (code: string) => {
  const messages: Record<string, string> = {
    PURCHASE_ORDER_REQUEST_INVALID: "Vérifie les champs du bon de commande.",
    PURCHASE_ORDER_AMOUNT_INVALID: "Le montant total doit être supérieur à zéro.",
    PURCHASE_CHANTIER_NOT_FOUND: "Le chantier n'existe plus. Actualise la page.",
    PURCHASE_CHANTIER_NOT_ACTIVE: "Aucune nouvelle commande sur un chantier fermé ou annulé.",
    PURCHASE_ORDER_VERSION_CONFLICT: "Ce BC a été modifié. Recharge la page.",
    MODULE_FORBIDDEN: "Tu n'as pas les droits de modification des achats.",
  };
  return messages[code] ?? code;
};

export function PurchaseOrdersWorkspace({ chantierId }: { chantierId?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [erreur, setError] = useState("");
  const [siteId, setSiteId] = useState(chantierId ?? "");
  const [supplierName, setSupplierName] = useState("");
  const [mode, setMode] = useState<"QUICK" | "DETAILED">("QUICK");
  const [description, setDescription] = useState("");
  const [allocations, setAllocations] = useState<QuickAllocation[]>([
    newAllocation(chantierId ?? ""),
  ]);
  const [lignes, setLines] = useState<EditableLine[]>([newLine()]);
  const [recherche, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState(chantierId ?? "ALL");
  const requestId = useRef<string>(crypto.randomUUID());

  async function reload() {
    const reponse = await fetch("/api/desktop/purchases", { cache: "no-store" });
    const json = (await reponse.json()) as Snapshot;
    if (!reponse.ok) throw new Error(json.error ?? "PURCHASE_ORDER_LOAD_FAILED");
    setSnapshot(json);
    return json;
  }
  useEffect(() => {
    void reload().catch(() => setError("Impossible de charger les bons de commande."));
  }, []);

  const allSites = snapshot?.chantiers ?? [];
  const sites = allSites.filter((site) => site.status === "ACTIVE");
  const destinations = [
    ...sites.map((site) => ({ id: site.id, label: `${site.name} · ${site.clientName ?? ""}` })),
    { id: "SAV", label: "SAV (hors chantier)" },
    { id: "GENERAL_EXPENSES", label: "Frais généraux (hors chantier)" },
  ];
  const selectionne =
    sites.find((site) => site.id === siteId)?.id ??
    sites.find((site) => site.id === chantierId)?.id ??
    sites[0]?.id ??
    "";
  const suppliers = useMemo(
    () =>
      [...new Set((snapshot?.payload.orders ?? []).map((commande) => commande.supplierName))].sort(
        (a, b) => a.localeCompare(b, "fr-FR"),
      ),
    [snapshot],
  );
  const commitmentTotals = snapshot ? committedPurchasesByDestination(snapshot.payload) : null;
  const linePreview = lignes.map((ligne) => {
    const qty = positiveQuantity(ligne.quantity);
    const prix = moneyCents(ligne.unitPrice);
    return qty !== null && prix !== null ? Math.round(qty * prix) : null;
  });
  const detailedTotal = linePreview.every((somme) => somme !== null)
    ? linePreview.reduce<number>((somme, cout) => somme + (cout ?? 0), 0)
    : null;
  const quickAmounts = allocations.map((entree) => moneyCents(entree.amount));
  const quickTotal =
    quickAmounts.every((valeur) => valeur !== null) && allocations.length > 0
      ? quickAmounts.reduce<number>((somme, valeur) => somme + (valeur ?? 0), 0)
      : null;
  const apercu = mode === "QUICK" ? quickTotal : detailedTotal;
  const all = snapshot?.payload.orders ?? [];
  const visible = all
    .filter(
      (commande) =>
        siteFilter === "ALL" ||
        (commande.allocations?.some(
          (allocation) => purchaseDestinationKey(allocation) === siteFilter,
        ) ??
          commande.chantierId === siteFilter),
    )
    .filter((commande) =>
      [
        commande.reference,
        commande.supplierName,
        commande.chantierName,
        ...(commande.allocations?.map((a) => a.chantierName) ?? []),
        commande.description,
      ]
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(recherche.trim().toLocaleLowerCase("fr-FR")),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const committed = snapshot ? committedPurchaseTotal(snapshot.payload, selectionne) : 0;

  function patchLine(id: string, cle: keyof EditableLine, valeur: string) {
    setLines((courant) =>
      courant.map((ligne) => (ligne.id === id ? { ...ligne, [cle]: valeur } : ligne)),
    );
    setError("");
  }
  async function create() {
    if (!snapshot?.canWrite || busy) return;
    setError("");
    if (!supplierName.trim()) {
      setError("Renseigne le nom du fournisseur.");
      return;
    }
    let commande: PurchaseOrderInput;
    if (mode === "QUICK") {
      const entrees = allocations.map((ligneTableau) => ({
        chantierId: ligneTableau.chantierId || selectionne,
        amountHtCents: moneyCents(ligneTableau.amount),
      }));
      if (
        entrees.some(
          (ligneTableau) => !destinations.some((element) => element.id === ligneTableau.chantierId),
        ) ||
        entrees.some(
          (ligneTableau) => ligneTableau.amountHtCents === null || ligneTableau.amountHtCents <= 0,
        ) ||
        new Set(entrees.map((ligneTableau) => ligneTableau.chantierId)).size !== entrees.length ||
        apercu === null ||
        apercu <= 0
      ) {
        setError("Indique une destination distincte et un montant HT positif sur chaque ligne.");
        return;
      }
      commande = {
        mode: "QUICK",
        allocations: entrees.map((ligneTableau) =>
          purchaseAllocationFromSelection(ligneTableau.chantierId, ligneTableau.amountHtCents!),
        ),
        supplierName: supplierName.trim(),
        description: description.trim(),
      };
    } else {
      if (!selectionne) {
        setError("Choisis un chantier actif pour le BC détaillé.");
        return;
      }
      const analyse: PurchaseOrderLine[] = [];
      for (const ligne of lignes) {
        const quantity = positiveQuantity(ligne.quantity);
        const unitPriceHtCents = moneyCents(ligne.unitPrice);
        if (
          !ligne.description.trim() ||
          !ligne.unit.trim() ||
          quantity === null ||
          unitPriceHtCents === null
        ) {
          setError("Chaque ligne doit avoir une désignation, quantité, unité et prix HT valides.");
          return;
        }
        analyse.push({
          id: ligne.id,
          description: ligne.description.trim(),
          quantity,
          unit: ligne.unit.trim(),
          unitPriceHtCents,
        });
      }
      if (detailedTotal === null || detailedTotal <= 0 || !Number.isSafeInteger(detailedTotal)) {
        setError("Vérifie les prix : le total HT doit être positif.");
        return;
      }
      commande = {
        mode: "DETAILED",
        chantierId: selectionne,
        supplierName: supplierName.trim(),
        description: description.trim(),
        lines: analyse,
      };
    }
    setBusy(true);
    try {
      const reponse = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CREATE", requestId: requestId.current, order: commande }),
      });
      const resultat = (await reponse.json()) as Snapshot;
      if (!reponse.ok) throw new Error(resultat.error ?? "PURCHASE_ORDER_CREATE_FAILED");
      setSnapshot((courant) => (courant ? { ...courant, payload: resultat.payload } : courant));
      const saved = resultat.payload.orders.find(
        (element) => element.requestId === requestId.current,
      );
      setNotice(
        `${saved?.reference ?? "BC"} enregistré comme coût engagé, sans envoi au fournisseur.`,
      );
      requestId.current = crypto.randomUUID();
      setAllocations((lignesTableau) =>
        lignesTableau.map((ligneTableau) => ({ ...ligneTableau, amount: "" })),
      );
      setDescription("");
      setLines([newLine()]);
    } catch (e) {
      setError(messageFor(e instanceof Error ? e.message : "PURCHASE_ORDER_CREATE_FAILED"));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string, expectedUpdatedAt: string) {
    if (
      !snapshot?.canWrite ||
      busy ||
      !window.confirm("Annuler ce BC ? Son engagement sera retiré, mais la trace restera visible.")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const reponse = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", orderId: id, expectedUpdatedAt }),
      });
      const resultat = (await reponse.json()) as Snapshot;
      if (!reponse.ok) throw new Error(resultat.error ?? "PURCHASE_ORDER_CANCEL_FAILED");
      setSnapshot((courant) => (courant ? { ...courant, payload: resultat.payload } : courant));
      setNotice("BC annulé. Il n'est plus comptabilisé parmi les engagements.");
    } catch (e) {
      setError(messageFor(e instanceof Error ? e.message : "PURCHASE_ORDER_CANCEL_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 22, display: "grid", gap: 18, maxWidth: 1480, margin: "0 auto" }}>
      <div>
        <h1>Achats · Bons de commande</h1>
        <p>
          Un BC enregistré est un <strong>coût engagé HT</strong>. Il ne crée ni facture
          fournisseur, ni coût réel validé, ni envoi automatique. Rapprochement Pennylane à venir.
        </p>
      </div>
      {erreur ? (
        <p role="alert" style={{ color: "#b33138" }}>
          {erreur}
        </p>
      ) : null}
      {notice ? (
        <p role="status" style={{ color: "#327550" }}>
          {notice}
        </p>
      ) : null}
      {commitmentTotals ? (
        <section style={{ background: "white", borderRadius: 12, padding: 18 }}>
          <h2>Engagements actuels HT · toutes dates</h2>
          <p>
            Chantiers : <strong>{euro(commitmentTotals.chantierCents)}</strong> · SAV :{" "}
            <strong>{euro(commitmentTotals.savCents)}</strong> · Frais généraux :{" "}
            <strong>{euro(commitmentTotals.generalExpensesCents)}</strong>
          </p>
          <p>
            Total unique : <strong>{euro(commitmentTotals.totalCents)}</strong>
          </p>
          <small>Ces engagements ne sont ni les factures du mois, ni un résultat réel.</small>
        </section>
      ) : null}
      {!snapshot ? (
        <p>Chargement des chantiers et des commandes…</p>
      ) : (
        <>
          <section
            style={{ background: "white", borderRadius: 12, padding: 18, display: "grid", gap: 14 }}
          >
            <h2>Nouveau bon de commande</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 12,
              }}
            >
              {mode === "DETAILED" ? (
                <label style={{ display: "grid", gap: 5 }}>
                  Chantier *
                  <select
                    value={selectionne}
                    disabled={busy || !snapshot.canWrite}
                    onChange={(e) => {
                      setSiteId(e.target.value);
                      setError("");
                    }}
                  >
                    {sites.length === 0 ? <option value="">Aucun chantier actif</option> : null}
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} · {site.clientName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label style={{ display: "grid", gap: 5 }}>
                Fournisseur *
                <input
                  aria-label="Fournisseur du BC"
                  list="bc-supplier-names"
                  maxLength={240}
                  placeholder="Nom du fournisseur"
                  value={supplierName}
                  disabled={busy || !snapshot.canWrite}
                  onChange={(e) => {
                    setSupplierName(e.target.value);
                    setError("");
                  }}
                />
                <datalist id="bc-supplier-names">
                  {suppliers.map((supplier) => (
                    <option key={supplier} value={supplier} />
                  ))}
                </datalist>
              </label>
            </div>
            <small>
              Fournisseurs proposés à partir des BC déjà saisis. Ce nom provisoire ne crée pas de
              fournisseur comptable dans Pennylane.
            </small>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className={mode === "QUICK" ? "primaryButton" : "secondaryButton"}
                aria-pressed={mode === "QUICK"}
                disabled={busy}
                onClick={() => setMode("QUICK")}
              >
                BC rapide · Montant global
              </button>
              <button
                type="button"
                className={mode === "DETAILED" ? "primaryButton" : "secondaryButton"}
                aria-pressed={mode === "DETAILED"}
                disabled={busy}
                onClick={() => setMode("DETAILED")}
              >
                BC détaillé · Articles
              </button>
            </div>
            <label style={{ display: "grid", gap: 5 }}>
              Description générale / remarque (facultative)
              <textarea
                value={description}
                maxLength={2000}
                rows={2}
                disabled={busy || !snapshot.canWrite}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {mode === "QUICK" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <strong>Répartition du BC par chantier, SAV ou frais généraux</strong>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 630, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                        <th>Destination</th>
                        <th>Montant HT (€)</th>
                        <th>Déjà engagé HT</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((ligneTableau, i) => {
                        const selectedDestination = ligneTableau.chantierId || selectionne;
                        return (
                          <tr key={ligneTableau.id}>
                            <td>
                              <select
                                aria-label={`Destination du BC rapide ligne ${i + 1}`}
                                value={selectedDestination}
                                disabled={busy || !snapshot.canWrite}
                                onChange={(e) => {
                                  setAllocations((courant) =>
                                    courant.map((element) =>
                                      element.id === ligneTableau.id
                                        ? { ...element, chantierId: e.target.value }
                                        : element,
                                    ),
                                  );
                                  setError("");
                                }}
                                style={{ width: "100%", minWidth: 210 }}
                              >
                                <option value="">Choisir une destination</option>
                                {!destinations.some(
                                  (element) => element.id === selectedDestination,
                                ) && selectedDestination ? (
                                  <option value={selectedDestination} disabled>
                                    Chantier indisponible : choisir une destination
                                  </option>
                                ) : null}
                                {destinations.map((element) => (
                                  <option key={element.id} value={element.id}>
                                    {element.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`Montant HT ligne chantier, SAV ou frais généraux ${i + 1}`}
                                inputMode="decimal"
                                placeholder="Ex. 250,00"
                                value={ligneTableau.amount}
                                disabled={busy || !snapshot.canWrite}
                                onChange={(e) => {
                                  setAllocations((courant) =>
                                    courant.map((element) =>
                                      element.id === ligneTableau.id
                                        ? { ...element, amount: e.target.value }
                                        : element,
                                    ),
                                  );
                                  setError("");
                                }}
                                style={{ width: 135 }}
                              />
                            </td>
                            <td>
                              {euro(
                                committedPurchaseDestinationTotal(
                                  snapshot.payload,
                                  selectedDestination,
                                ),
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="secondaryButton"
                                disabled={allocations.length === 1 || busy || !snapshot.canWrite}
                                onClick={() =>
                                  setAllocations((courant) =>
                                    courant.filter((element) => element.id !== ligneTableau.id),
                                  )
                                }
                              >
                                Retirer
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={busy || !snapshot.canWrite || allocations.length >= 100}
                  onClick={() => {
                    const firstUnused = destinations.find(
                      (element) =>
                        !allocations.some((a) => (a.chantierId || selectionne) === element.id),
                    );
                    if (firstUnused)
                      setAllocations((courant) => [...courant, newAllocation(firstUnused.id)]);
                    else setError("Toutes les destinations disponibles sont déjà sélectionnées.");
                  }}
                >
                  Ajouter un chantier / SAV / frais généraux
                </button>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 810, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                      <th>Désignation</th>
                      <th>Qté</th>
                      <th>Unité</th>
                      <th>PU HT (€)</th>
                      <th style={{ textAlign: "right" }}>Total HT</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((ligne, i) => (
                      <tr key={ligne.id}>
                        <td>
                          <input
                            aria-label={`Désignation ligne ${i + 1}`}
                            value={ligne.description}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(ligne.id, "description", e.target.value)}
                            style={{ width: "100%", minWidth: 230 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Quantité ligne ${i + 1}`}
                            inputMode="decimal"
                            value={ligne.quantity}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(ligne.id, "quantity", e.target.value)}
                            style={{ width: 80 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Unité ligne ${i + 1}`}
                            value={ligne.unit}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(ligne.id, "unit", e.target.value)}
                            style={{ width: 75 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Prix unitaire ligne ${i + 1}`}
                            inputMode="decimal"
                            value={ligne.unitPrice}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(ligne.id, "unitPrice", e.target.value)}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {linePreview[i] === null ? "À renseigner" : euro(linePreview[i] ?? 0)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondaryButton"
                            disabled={lignes.length === 1 || busy || !snapshot.canWrite}
                            onClick={() =>
                              setLines((courant) => courant.filter((x) => x.id !== ligne.id))
                            }
                          >
                            Retirer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={busy || !snapshot.canWrite || lignes.length >= 200}
                  onClick={() => setLines((courant) => [...courant, newLine()])}
                >
                  Ajouter une ligne
                </button>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <strong>Total du BC : {apercu === null ? "À renseigner" : euro(apercu)}</strong>
                {mode === "DETAILED" ? (
                  <div>Déjà engagé sur ce chantier : {euro(committed)}</div>
                ) : (
                  <div>Le montant global sera ventilé une seule fois entre les destinations.</div>
                )}
              </div>
              <button
                type="button"
                className="primaryButton"
                disabled={busy || !snapshot.canWrite || (mode === "DETAILED" && sites.length === 0)}
                onClick={() => void create()}
              >
                Enregistrer le BC (engagement)
              </button>
            </div>
          </section>
          <section
            style={{ background: "white", borderRadius: 12, padding: 18, display: "grid", gap: 12 }}
          >
            <h2>Liste des bons de commande ({all.length})</h2>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <input
                aria-label="Rechercher un BC"
                placeholder="Référence, fournisseur, chantier, SAV…"
                value={recherche}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 230, flex: 2 }}
              />
              <select
                aria-label="Filtrer les BC par chantier, SAV ou frais généraux"
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="ALL">Toutes les destinations</option>
                <option value="SAV">SAV</option>
                <option value="GENERAL_EXPENSES">Frais généraux</option>
                {allSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => void reload().catch(() => setError("Actualisation impossible."))}
              >
                Actualiser
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                    <th>Référence</th>
                    <th>Date</th>
                    <th>Fournisseur</th>
                    <th>Destination</th>
                    <th>Mode</th>
                    <th>Statut</th>
                    <th style={{ textAlign: "right" }}>HT du BC complet</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((commande) => (
                    <tr key={commande.id} style={{ borderBottom: "1px solid #ece8f0" }}>
                      <td style={{ padding: 8 }}>{commande.reference}</td>
                      <td style={{ padding: 8 }}>
                        {new Date(commande.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 8 }}>{commande.supplierName}</td>
                      <td style={{ padding: 8 }}>
                        {commande.allocations?.length ? (
                          <details>
                            <summary>{commande.allocations.length} destination(s)</summary>
                            {commande.allocations.map((a) => (
                              <div key={purchaseDestinationKey(a)}>
                                {a.chantierName} : {euro(a.amountHtCents)}
                              </div>
                            ))}
                          </details>
                        ) : (
                          commande.chantierName
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {commande.mode === "QUICK"
                          ? "Rapide"
                          : `Détaillé (${commande.lines.length})`}
                      </td>
                      <td style={{ padding: 8 }}>
                        {commande.status === "CANCELLED" ? "Annulé" : "Engagé · Non envoyé"}
                      </td>
                      <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                        {euro(commande.amountHtCents)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {commande.status === "COMMITTED" &&
                        snapshot.canWrite &&
                        !commande.removedAllocations?.length ? (
                          <Link
                            className="secondaryButton"
                            href={`/achats/${encodeURIComponent(commande.id)}/modifier`}
                          >
                            Modifier
                          </Link>
                        ) : null}
                        {commande.status === "COMMITTED" && snapshot.canWrite ? (
                          <button
                            type="button"
                            className="secondaryButton"
                            disabled={busy}
                            onClick={() => void cancel(commande.id, commande.updatedAt)}
                          >
                            Annuler
                          </button>
                        ) : null}
                        {commande.mode === "DETAILED" ? (
                          <>
                            <a
                              className="secondaryButton"
                              href={`/api/desktop/purchases/${encodeURIComponent(commande.id)}/pdf`}
                              aria-label={`Télécharger le PDF du ${commande.reference}`}
                            >
                              PDF
                            </a>
                            <details>
                              <summary>Lignes</summary>
                              {commande.lines.map((ligne) => (
                                <div key={ligne.id}>
                                  {ligne.description} · {ligne.quantity} {ligne.unit} ×{" "}
                                  {euro(ligne.unitPriceHtCents)}
                                </div>
                              ))}
                            </details>
                          </>
                        ) : commande.description ? (
                          <small>{commande.description}</small>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 ? <p>Aucun BC pour cette sélection.</p> : null}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
