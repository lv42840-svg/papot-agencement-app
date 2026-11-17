"use client";

import Link from "next/link";
import { evaluateNumericExpression, numericExpressionInput } from "@/lib/numeric-expression";
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

type Site = { id: string; name: string; clientName?: string | null; reference?: string | null; status: string };
type Snapshot = {
  payload: PurchaseOrdersPayload;
  chantiers: Site[];
  canWrite: boolean;
  supplierCatalog?: {
    suppliers: Array<{ id: string; name: string }>;
    synced: boolean;
    syncedAt: string | null;
  };
};
type Allocated = { id: string; chantierId: string; amount: string };
type Line = { id: string; description: string; quantity: string; unit: string; unitPrice: string };
const euros = (value: number) =>
  (value / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const amountText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const parseAmount = (text: string) => {
  const number = evaluateNumericExpression(text, 2, 0, 1_000_000_000);
  return number === null ? null : Math.round(number * 100);
};
const parseQuantity = (text: string) =>
  evaluateNumericExpression(text, 6, 0.000001, 1_000_000);

export function PurchaseOrderEditWorkspace({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [original, setOriginal] = useState<PurchaseOrder | null>(null);
  const [supplier, setSupplier] = useState("");
  const [supplierPennylaneId, setSupplierPennylaneId] = useState("");
  const [description, setDescription] = useState("");
  const [allocations, setAllocations] = useState<Allocated[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [siteId, setSiteId] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [extraDestinations, setExtraDestinations] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function initialize(order: PurchaseOrder) {
    setOriginal(order);
    setSupplier(order.supplierName);
    setSupplierPennylaneId(order.supplierPennylaneId ?? "");
    setDescription(order.description);
    setSiteId(order.chantierId ?? "");
    setAllocations(
      purchaseOrderAllocations(order).map((item) => ({
        id: crypto.randomUUID(),
        chantierId: purchaseDestinationKey(item),
        amount: amountText(item.amountHtCents),
      })),
    );
    setLines(
      order.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: String(line.quantity).replace(".", ","),
        unit: line.unit,
        unitPrice: amountText(line.unitPriceHtCents),
      })),
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/desktop/purchases", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Impossible de charger les commandes.");
        const payload = (await response.json()) as Snapshot;
        const order = payload.payload.orders.find((entry) => entry.id === orderId);
        if (!order) throw new Error("Bon de commande introuvable.");
        if (!controller.signal.aborted) {
          setData(payload);
          initialize(order);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      }
    })();
    return () => controller.abort();
  }, [orderId]);

  const sites = data?.chantiers ?? [];
  const destinations = [
    ...sites.map((site) => ({ id: site.id, name: site.name, active: site.status === "ACTIVE" })),
    { id: "SAV", name: "SAV (hors chantier)", active: true },
    { id: "GENERAL_EXPENSES", name: "Frais généraux (hors chantier)", active: true },
  ];
  const filteredSites = sites.filter((site) =>
    [site.name, site.clientName, site.reference].filter(Boolean).join(" ").toLocaleLowerCase("fr-FR")
      .includes(siteSearch.trim().toLocaleLowerCase("fr-FR")),
  );
  const filteredDestinations = destinations.filter((destination) =>
    destination.name.toLocaleLowerCase("fr-FR").includes(siteSearch.trim().toLocaleLowerCase("fr-FR")),
  );
  const suppliers = useMemo(
    () => [...new Set(data?.payload.orders.map((order) => order.supplierName) ?? [])].sort(),
    [data],
  );
  const readOnly =
    original?.status !== "COMMITTED" ||
    Boolean(original.removedAllocations?.length) ||
    !data?.canWrite;
  const quickTotal = allocations.reduce<number | null>((sum, line) => {
    const amount = parseAmount(line.amount);
    return sum === null || amount === null ? null : sum + amount;
  }, 0);
  const detailedTotal = lines.reduce<number | null>((sum, line) => {
    const quantity = parseQuantity(line.quantity);
    const price = parseAmount(line.unitPrice);
    return sum === null || quantity === null || price === null
      ? null
      : sum + Math.round(quantity * price);
  }, 0);
  const preview = original?.mode === "QUICK" ? quickTotal : detailedTotal;

  async function save() {
    if (!data || !original || busy || readOnly) return;
    setError("");
    if (data.supplierCatalog?.synced && !supplierPennylaneId) {
      setError("Sélectionne un fournisseur Pennylane avant de modifier le BC.");
      return;
    }
    if (!supplier.trim()) {
      setError("Le fournisseur est obligatoire.");
      return;
    }
    let input: PurchaseOrderInput;
    if (original.mode === "QUICK") {
      const rows = allocations.map((row) => ({
        chantierId: row.chantierId,
        amountHtCents: parseAmount(row.amount),
      }));
      if (
        !rows.length ||
        rows.some(
          (row) =>
            !destinations.some((item) => item.id === row.chantierId) ||
            row.amountHtCents === null ||
            row.amountHtCents <= 0,
        ) ||
        new Set(rows.map((row) => row.chantierId)).size !== rows.length ||
        preview === null ||
        preview <= 0
      ) {
        setError("Indique une destination distincte et un montant HT positif par ligne.");
        return;
      }
      input = {
        mode: "QUICK",
        supplierName: supplier.trim(),
        supplierPennylaneId: data.supplierCatalog?.synced
          ? supplierPennylaneId
          : original.supplierPennylaneId,
        description: description.trim(),
        allocations: rows.map((row) =>
          purchaseAllocationFromSelection(row.chantierId, row.amountHtCents!),
        ),
      };
    } else {
      const parsed: PurchaseOrderLine[] = [];
      for (const line of lines) {
        const quantity = parseQuantity(line.quantity);
        const unitPriceHtCents = parseAmount(line.unitPrice);
        if (
          !line.description.trim() ||
          !line.unit.trim() ||
          quantity === null ||
          unitPriceHtCents === null
        ) {
          setError("Chaque article doit avoir une désignation, quantité, unité et un prix valide.");
          return;
        }
        parsed.push({
          id: line.id,
          description: line.description.trim(),
          quantity,
          unit: line.unit.trim(),
          unitPriceHtCents,
        });
      }
      if (!parsed.length || preview === null || preview <= 0) {
        setError("Le BC détaillé doit comporter des articles et un montant HT positif.");
        return;
      }
      input = {
        mode: "DETAILED",
        chantierId: siteId,
        supplierName: supplier.trim(),
        supplierPennylaneId: data.supplierCatalog?.synced
          ? supplierPennylaneId
          : original.supplierPennylaneId,
        description: description.trim(),
        lines: parsed,
      };
    }
    setBusy(true);
    try {
      const response = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE",
          orderId: original.id,
          expectedUpdatedAt: original.updatedAt,
          order: input,
        }),
      });
      const result = (await response.json()) as { payload?: PurchaseOrdersPayload; error?: string };
      if (!response.ok || !result.payload) {
        const errors: Record<string, string> = {
          PURCHASE_ORDER_VERSION_CONFLICT:
            "Ce BC a été modifié depuis ton ouverture. Actualise la page.",
          PURCHASE_ORDER_NOT_EDITABLE:
            "Ce BC est annulé ou comporte un engagement retiré à la clôture. Il ne peut plus être modifié.",
          PURCHASE_CHANTIER_NOT_FOUND: "Un chantier n'existe plus.",
          PURCHASE_CHANTIER_NOT_ACTIVE:
            "Aucun nouvel engagement sur un chantier fermé ou annulé. Les affectations historiques inchangées restent conservées.",
        };
        throw new Error(
          errors[result.error ?? ""] ?? "Enregistrement impossible. Vérifie les données.",
        );
      }
      const updated = result.payload.orders.find((order) => order.id === original.id);
      if (!updated) throw new Error("Le BC enregistré est introuvable.");
      setData({ ...data, payload: result.payload });
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
      {error ? (
        <p role="alert" style={{ color: "#b33138" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" style={{ color: "#276748" }}>
          {notice}
        </p>
      ) : null}
      {!data && !error ? <p>Chargement du BC…</p> : null}
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
            {data?.supplierCatalog?.synced ? (
              <select
                value={supplierPennylaneId}
                disabled={readOnly || busy}
                onChange={(event) => {
                  const id = event.target.value;
                  setSupplierPennylaneId(id);
                  setSupplier(
                    data.supplierCatalog?.suppliers.find((item) => item.id === id)?.name ?? "",
                  );
                }}
              >
                <option value="">Choisir un fournisseur Pennylane</option>
                {data?.supplierCatalog?.suppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  list="edit-bc-suppliers"
                  value={supplier}
                  disabled={readOnly || busy}
                  onChange={(event) => setSupplier(event.target.value)}
                />
                <datalist id="edit-bc-suppliers">
                  {suppliers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            Descriptif / remarque
            <textarea
              rows={3}
              maxLength={2000}
              value={description}
              disabled={readOnly || busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {original.mode === "QUICK" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <h2>Montants par chantier, SAV ou frais généraux</h2>
              <input type="search" aria-label="Rechercher une destination pour modifier le BC"
                placeholder="Filtrer les chantiers par nom, référence ou client"
                value={siteSearch} onChange={(event) => setSiteSearch(event.target.value)} />
              {allocations.map((row, index) => (
                <div
                  key={row.id}
                  style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}
                >
                  <select
                    aria-label={`Destination ligne ${index + 1}`}
                    value={row.chantierId}
                    disabled={readOnly || busy}
                    onChange={(event) =>
                      setAllocations((items) =>
                        items.map((item) =>
                          item.id === row.id ? { ...item, chantierId: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    {destinations.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={!item.active && item.id !== row.chantierId}
                      >
                        {item.name}
                        {item.active ? "" : " (fermé / annulé)"}
                      </option>
                    ))}
                  </select>
                  <label>
                    Montant HT (€)
                    <input
                      aria-label={`Montant HT ligne ${index + 1}`}
                      inputMode="decimal"
                      value={row.amount}
                      disabled={readOnly || busy}
                      onChange={(event) =>
                        setAllocations((items) =>
                          items.map((item) =>
                            item.id === row.id ? { ...item, amount: event.target.value } : item,
                          ),
                        )
                      }
                    onBlur={() => setAllocations((items) =>
                        items.map((item) => item.id === row.id
                          ? { ...item, amount: numericExpressionInput(item.amount, 2) } : item)
                      )}
                      />
                  </label>
                  <button
                    className="secondaryButton"
                    type="button"
                    disabled={readOnly || busy || allocations.length === 1}
                    onClick={() =>
                      setAllocations((items) => items.filter((item) => item.id !== row.id))
                    }
                  >
                    Retirer la ligne
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {filteredDestinations.filter((item) => item.active &&
                  !allocations.some((row) => row.chantierId === item.id)).slice(0, 25).map((item) => (
                  <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input type="checkbox" aria-label={`Ajouter ${item.name}`}
                      checked={extraDestinations.includes(item.id)}
                      disabled={readOnly || busy}
                      onChange={(event) => setExtraDestinations((old) => event.target.checked
                        ? [...new Set([...old, item.id])]
                        : old.filter((id) => id !== item.id))} />
                    {item.name}
                  </label>
                ))}
              </div>
              <button type="button" className="secondaryButton"
                disabled={readOnly || busy || allocations.length >= 100}
                onClick={() => {
                  const candidate = filteredDestinations.find((item) =>
                    item.active && !allocations.some((row) => row.chantierId === item.id));
                  const ids = (extraDestinations.length ? extraDestinations : candidate ? [candidate.id] : [])
                    .filter((id) => destinations.some((x) => x.active && x.id === id) &&
                      !allocations.some((row) => row.chantierId === id));
                  setAllocations((rows) => [...rows, ...ids.slice(0, 100-rows.length).map((id) => ({
                    id: crypto.randomUUID(), chantierId: id, amount: "",
                  }))]);
                  setExtraDestinations([]);
                }>
                Ajouter les destinations sélectionnées ({extraDestinations.length || 1})
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Chantier
                <input type="search" aria-label="Filtrer les chantiers dans le BC détaillé"
                  value={siteSearch} onChange={(event) => setSiteSearch(event.target.value)}
                  placeholder="Nom, référence, client..." />
                <select
                  value={siteId}
                  disabled={readOnly || busy}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  {sites.filter((site) => site.id === siteId || filteredSites.some((item) => item.id === site.id)).map((site) => (
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
              {lines.map((line, index) => (
                <div
                  key={line.id}
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}
                >
                  <label style={{ flex: "3 1 200px" }}>
                    Désignation
                    <input
                      aria-label={`Désignation ligne ${index + 1}`}
                      value={line.description}
                      disabled={readOnly || busy}
                      style={{ width: "100%" }}
                      onChange={(event) =>
                        setLines((list) =>
                          list.map((item) =>
                            item.id === line.id
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  {(["quantity", "unit", "unitPrice"] as const).map((field) => (
                    <label key={field}>
                      {field === "quantity" ? "Qté" : field === "unit" ? "Unité" : "PU HT (€)"}
                      <input
                        aria-label={`${field} ligne ${index + 1}`}
                        value={line[field]}
                        disabled={readOnly || busy}
                        style={{ width: 95 }}
                        onChange={(event) =>
                          setLines((list) =>
                            list.map((item) =>
                              item.id === line.id ? { ...item, [field]: event.target.value } : item,
                            ),
                          )
                        }
                        onBlur={() => {
                          if (field === "unit") return;
                          setLines((list) => list.map((item) => item.id === line.id
                            ? { ...item, [field]: numericExpressionInput(item[field], field === "quantity" ? 6 : 2, field === "quantity" ? 0.000001 : 0) }
                            : item));
                        }}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={readOnly || busy || lines.length === 1}
                    onClick={() => setLines((list) => list.filter((item) => item.id !== line.id))}
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondaryButton"
                disabled={readOnly || busy || lines.length >= 200}
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
            <strong>Total HT : {preview === null ? "À renseigner" : euros(preview)}</strong>
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
