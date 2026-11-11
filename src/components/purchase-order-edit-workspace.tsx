"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLine,
  PurchaseOrdersPayload,
} from "@/lib/purchases/domain";
import {
  purchaseAllocationFromSelection,
  purchaseDestinationKey,
  purchaseOrderAllocations,
} from "@/lib/purchases/domain";

type Site = { id: string; name: string; status: string };
type Snapshot = {
  payload: PurchaseOrdersPayload;
  chantiers: Site[];
  canWrite: boolean;
};
type Allocated = { id: string; chantierId: string; amount: string };
type Line = { id: string; description: string; quantity: string; unit: string; unitPrice: string };
const euros = (valeur: number) =>
  (valeur / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const amountText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const parseAmount = (texte: string) => {
  const valeur = texte.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(valeur)) return null;
  const cents = Math.round(Number(valeur) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
};
const parseQuantity = (texte: string) => {
  const valeur = texte.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(valeur)) return null;
  const number = Number(valeur);
  return Number.isFinite(number) && number > 0 && number <= 1_000_000 ? number : null;
};

export function PurchaseOrderEditWorkspace({ orderId: idCommande }: { orderId: string }) {
  const [donnees, setData] = useState<Snapshot | null>(null);
  const [original, setOriginal] = useState<PurchaseOrder | null>(null);
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");
  const [allocations, setAllocations] = useState<Allocated[]>([]);
  const [lignes, setLines] = useState<Line[]>([]);
  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState("");
  const [notice, setNotice] = useState("");

  function initialize(commande: PurchaseOrder) {
    setOriginal(commande);
    setSupplier(commande.supplierName);
    setDescription(commande.description);
    setSiteId(commande.chantierId ?? "");
    setAllocations(
      purchaseOrderAllocations(commande).map((element) => ({
        id: crypto.randomUUID(),
        chantierId: purchaseDestinationKey(element),
        amount: amountText(element.amountHtCents),
      })),
    );
    setLines(
      commande.lines.map((ligne) => ({
        id: ligne.id,
        description: ligne.description,
        quantity: String(ligne.quantity).replace(".", ","),
        unit: ligne.unit,
        unitPrice: amountText(ligne.unitPriceHtCents),
      })),
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const reponse = await fetch("/api/desktop/purchases", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!reponse.ok) throw new Error("Impossible de charger les commandes.");
        const contenu = (await reponse.json()) as Snapshot;
        const commande = contenu.payload.orders.find((entree) => entree.id === idCommande);
        if (!commande) throw new Error("Bon de commande introuvable.");
        if (!controller.signal.aborted) {
          setData(contenu);
          initialize(commande);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      }
    })();
    return () => controller.abort();
  }, [idCommande]);

  const sites = donnees?.chantiers ?? [];
  const destinations = [
    ...sites.map((site) => ({ id: site.id, name: site.name, active: site.status === "ACTIVE" })),
    { id: "SAV", name: "SAV (hors chantier)", active: true },
    { id: "GENERAL_EXPENSES", name: "Frais généraux (hors chantier)", active: true },
  ];
  const suppliers = useMemo(
    () =>
      [...new Set(donnees?.payload.orders.map((commande) => commande.supplierName) ?? [])].sort(),
    [donnees],
  );
  const readOnly =
    original?.status !== "COMMITTED" ||
    Boolean(original.removedAllocations?.length) ||
    !donnees?.canWrite;
  const quickTotal = allocations.reduce<number | null>((somme, ligne) => {
    const montant = parseAmount(ligne.amount);
    return somme === null || montant === null ? null : somme + montant;
  }, 0);
  const detailedTotal = lignes.reduce<number | null>((somme, ligne) => {
    const quantity = parseQuantity(ligne.quantity);
    const prix = parseAmount(ligne.unitPrice);
    return somme === null || quantity === null || prix === null
      ? null
      : somme + Math.round(quantity * prix);
  }, 0);
  const apercu = original?.mode === "QUICK" ? quickTotal : detailedTotal;

  async function save() {
    if (!donnees || !original || busy || readOnly) return;
    setError("");
    if (!supplier.trim()) {
      setError("Le fournisseur est obligatoire.");
      return;
    }
    let saisie: PurchaseOrderInput;
    if (original.mode === "QUICK") {
      const lignesTableau = allocations.map((ligneTableau) => ({
        chantierId: ligneTableau.chantierId,
        amountHtCents: parseAmount(ligneTableau.amount),
      }));
      if (
        !lignesTableau.length ||
        lignesTableau.some(
          (ligneTableau) =>
            !destinations.some((element) => element.id === ligneTableau.chantierId) ||
            ligneTableau.amountHtCents === null ||
            ligneTableau.amountHtCents <= 0,
        ) ||
        new Set(lignesTableau.map((ligneTableau) => ligneTableau.chantierId)).size !==
          lignesTableau.length ||
        apercu === null ||
        apercu <= 0
      ) {
        setError("Indique une destination distincte et un montant HT positif par ligne.");
        return;
      }
      saisie = {
        mode: "QUICK",
        supplierName: supplier.trim(),
        description: description.trim(),
        allocations: lignesTableau.map((ligneTableau) =>
          purchaseAllocationFromSelection(ligneTableau.chantierId, ligneTableau.amountHtCents!),
        ),
      };
    } else {
      const analyse: PurchaseOrderLine[] = [];
      for (const ligne of lignes) {
        const quantity = parseQuantity(ligne.quantity);
        const unitPriceHtCents = parseAmount(ligne.unitPrice);
        if (
          !ligne.description.trim() ||
          !ligne.unit.trim() ||
          quantity === null ||
          unitPriceHtCents === null
        ) {
          setError("Chaque article doit avoir une désignation, quantité, unité et un prix valide.");
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
      if (!analyse.length || apercu === null || apercu <= 0) {
        setError("Le BC détaillé doit comporter des articles et un montant HT positif.");
        return;
      }
      saisie = {
        mode: "DETAILED",
        chantierId: siteId,
        supplierName: supplier.trim(),
        description: description.trim(),
        lines: analyse,
      };
    }
    setBusy(true);
    try {
      const reponse = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE",
          orderId: original.id,
          expectedUpdatedAt: original.updatedAt,
          order: saisie,
        }),
      });
      const resultat = (await reponse.json()) as {
        payload?: PurchaseOrdersPayload;
        error?: string;
      };
      if (!reponse.ok || !resultat.payload) {
        const erreurs: Record<string, string> = {
          PURCHASE_ORDER_VERSION_CONFLICT:
            "Ce BC a été modifié depuis ton ouverture. Actualise la page.",
          PURCHASE_ORDER_NOT_EDITABLE:
            "Ce BC est annulé ou comporte un engagement retiré à la clôture. Il ne peut plus être modifié.",
          PURCHASE_CHANTIER_NOT_FOUND: "Un chantier n'existe plus.",
          PURCHASE_CHANTIER_NOT_ACTIVE:
            "Aucun nouvel engagement sur un chantier fermé ou annulé. Les affectations historiques inchangées restent conservées.",
        };
        throw new Error(
          erreurs[resultat.error ?? ""] ?? "Enregistrement impossible. Vérifie les données.",
        );
      }
      const updated = resultat.payload.orders.find((commande) => commande.id === original.id);
      if (!updated) throw new Error("Le BC enregistré est introuvable.");
      setData({ ...donnees, payload: resultat.payload });
      initialize(updated);
      setNotice("Modifications enregistrées. Les engagements et le PDF sont actualisés.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 22, display: "grid", gap: 16 }}>
      <Link className="secondaryButton" href="/achats">
        Retour aux bons de commande
      </Link>
      <h1>Modifier un bon de commande</h1>
      {erreur ? (
        <p role="alert" style={{ color: "#b33138" }}>
          {erreur}
        </p>
      ) : null}
      {notice ? (
        <p role="status" style={{ color: "#276748" }}>
          {notice}
        </p>
      ) : null}
      {!donnees && !erreur ? <p>Chargement du BC…</p> : null}
      {original ? (
        <section
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 16 }}
        >
          <div>
            <strong>{original.reference}</strong> ·{" "}
            {original.mode === "QUICK" ? "BC rapide" : "BC détaillé"}
            <p>
              Un BC conserve son numéro et ses précédentes valeurs dans son historique de révisions.
            </p>
          </div>
          {readOnly ? (
            <p role="status">
              Ce BC est en lecture seule : commande annulée, engagement retiré ou droit Achats en
              écriture absent.
            </p>
          ) : null}
          <label style={{ display: "grid", gap: 5 }}>
            Fournisseur
            <input
              list="edit-bc-suppliers"
              value={supplier}
              disabled={readOnly || busy}
              onChange={(evenement) => setSupplier(evenement.target.value)}
            />
            <datalist id="edit-bc-suppliers">
              {suppliers.map((nom) => (
                <option key={nom} value={nom} />
              ))}
            </datalist>
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            Descriptif / remarque
            <textarea
              rows={3}
              maxLength={2000}
              value={description}
              disabled={readOnly || busy}
              onChange={(evenement) => setDescription(evenement.target.value)}
            />
          </label>
          {original.mode === "QUICK" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <h2>Montants par chantier, SAV ou frais généraux</h2>
              {allocations.map((ligneTableau, indice) => (
                <div
                  key={ligneTableau.id}
                  style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}
                >
                  <select
                    aria-label={`Destination ligne ${indice + 1}`}
                    value={ligneTableau.chantierId}
                    disabled={readOnly || busy}
                    onChange={(evenement) =>
                      setAllocations((elements) =>
                        elements.map((element) =>
                          element.id === ligneTableau.id
                            ? { ...element, chantierId: evenement.target.value }
                            : element,
                        ),
                      )
                    }
                  >
                    {destinations.map((element) => (
                      <option
                        key={element.id}
                        value={element.id}
                        disabled={!element.active && element.id !== ligneTableau.chantierId}
                      >
                        {element.name}
                        {element.active ? "" : " (fermé / annulé)"}
                      </option>
                    ))}
                  </select>
                  <label>
                    Montant HT (€)
                    <input
                      aria-label={`Montant HT ligne ${indice + 1}`}
                      inputMode="decimal"
                      value={ligneTableau.amount}
                      disabled={readOnly || busy}
                      onChange={(evenement) =>
                        setAllocations((elements) =>
                          elements.map((element) =>
                            element.id === ligneTableau.id
                              ? { ...element, amount: evenement.target.value }
                              : element,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="secondaryButton"
                    type="button"
                    disabled={readOnly || busy || allocations.length === 1}
                    onClick={() =>
                      setAllocations((elements) =>
                        elements.filter((element) => element.id !== ligneTableau.id),
                      )
                    }
                  >
                    Retirer la ligne
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondaryButton"
                disabled={readOnly || busy || allocations.length >= 100}
                onClick={() => {
                  const destination = destinations.find(
                    (candidat) =>
                      candidat.active &&
                      !allocations.some((ligneTableau) => ligneTableau.chantierId === candidat.id),
                  );
                  if (destination)
                    setAllocations((lignesTableau) => [
                      ...lignesTableau,
                      { id: crypto.randomUUID(), chantierId: destination.id, amount: "" },
                    ]);
                }}
              >
                Ajouter un chantier / SAV / frais généraux
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Chantier
                <select
                  value={siteId}
                  disabled={readOnly || busy}
                  onChange={(evenement) => setSiteId(evenement.target.value)}
                >
                  {sites.map((site) => (
                    <option
                      key={site.id}
                      value={site.id}
                      disabled={site.status !== "ACTIVE" && site.id !== siteId}
                    >
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
              <h2>Articles</h2>
              {lignes.map((ligne, indice) => (
                <div
                  key={ligne.id}
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}
                >
                  <label style={{ flex: "3 1 200px" }}>
                    Désignation
                    <input
                      aria-label={`Désignation ligne ${indice + 1}`}
                      value={ligne.description}
                      disabled={readOnly || busy}
                      style={{ width: "100%" }}
                      onChange={(evenement) =>
                        setLines((list) =>
                          list.map((element) =>
                            element.id === ligne.id
                              ? { ...element, description: evenement.target.value }
                              : element,
                          ),
                        )
                      }
                    />
                  </label>
                  {(["quantity", "unit", "unitPrice"] as const).map((field) => (
                    <label key={field}>
                      {field === "quantity" ? "Qté" : field === "unit" ? "Unité" : "PU HT (€)"}
                      <input
                        aria-label={`${field} ligne ${indice + 1}`}
                        value={ligne[field]}
                        disabled={readOnly || busy}
                        style={{ width: 95 }}
                        onChange={(evenement) =>
                          setLines((list) =>
                            list.map((element) =>
                              element.id === ligne.id
                                ? { ...element, [field]: evenement.target.value }
                                : element,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={readOnly || busy || lignes.length === 1}
                    onClick={() =>
                      setLines((list) => list.filter((element) => element.id !== ligne.id))
                    }
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondaryButton"
                disabled={readOnly || busy || lignes.length >= 200}
                onClick={() =>
                  setLines((list) => [
                    ...list,
                    {
                      id: crypto.randomUUID(),
                      description: "",
                      quantity: "1",
                      unit: "u",
                      unitPrice: "",
                    },
                  ])
                }
              >
                Ajouter un article
              </button>
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <strong>Total HT : {apercu === null ? "À renseigner" : euros(apercu)}</strong>
            <button
              type="button"
              className="primaryButton"
              disabled={readOnly || busy}
              onClick={() => void save()}
            >
              {busy ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
          </div>
          {original.mode === "DETAILED" ? (
            <a
              className="secondaryButton"
              href={`/api/desktop/purchases/${encodeURIComponent(original.id)}/pdf`}
            >
              Télécharger le PDF actualisé
            </a>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
