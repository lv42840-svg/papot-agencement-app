"use client";

import Link from "next/link";
import { PennylaneSupplierPicker } from "@/components/pennylane-supplier-picker";
import { CheckboxChoiceList } from "@/components/checkbox-choice-list";
import { PurchaseDestinationMultiPicker } from "@/components/purchase-destination-multi-picker";
import { evaluateNumericExpression, numericExpressionInput } from "@/lib/numeric-expression";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PurchaseOrderInput,
  PurchaseOrderLine,
  PurchaseOrder,
  PurchaseOrdersPayload,
} from "@/lib/purchases/domain";
import {
  purchaseAllocationFromSelection,
  purchaseDestinationKey,
  purchaseOrderAllocations,
} from "@/lib/purchases/domain";

type Site = {
  id: string;
  name: string;
  clientName: string;
  reference?: string | null;
  status: string;
};
type Snapshot = {
  payload: PurchaseOrdersPayload;
  chantiers: Site[];
  canWrite: boolean;
  supplierCatalog?: {
    suppliers: Array<{ id: string; name: string }>;
    synced: boolean;
    syncedAt: string | null;
  };
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
  const value = evaluateNumericExpression(raw, 2, 0, 1_000_000_000);
  if (value === null) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
function positiveQuantity(raw: string): number | null {
  return evaluateNumericExpression(raw, 6, 0.000001, 1_000_000);
}
const messageFor = (code: string) => {
  const messages: Record<string, string> = {
    PURCHASE_ORDER_REQUEST_INVALID: "Vérifie les champs du bon de commande.",
    PURCHASE_ORDER_AMOUNT_INVALID: "Le montant total doit être supérieur à zéro.",
    PURCHASE_CHANTIER_NOT_FOUND: "Le chantier n'existe plus. Actualise la page.",
    PURCHASE_CHANTIER_NOT_ACTIVE: "Aucune nouvelle commande sur un chantier fermé ou annulé.",
    PURCHASE_ORDER_VERSION_CONFLICT: "Ce BC a été modifié. Recharge la page.",
    MODULE_FORBIDDEN: "Tu n'as pas les droits de modification des achats.",
    PURCHASE_SUPPLIER_PENNYLANE_REQUIRED:
      "Choisis un fournisseur de la liste officielle Pennylane.",
    PENNYLANE_DISABLED: "La synchronisation Pennylane doit être activée sur le serveur.",
    INVOICE_FG_SUPPLIERS_NOT_CONFIGURED: "Sélectionne et enregistre d’abord les fournisseurs FG.",
    INVOICE_NOT_IMPORTED: "Aucune facture Pennylane n’a encore été importée.",
  };
  return messages[code] ?? code;
};

export function PurchaseOrdersWorkspace({ chantierId }: { chantierId?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [siteId, setSiteId] = useState(chantierId ?? "");
  const [siteQuery, setSiteQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [extraDestinations, setExtraDestinations] = useState<string[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPennylaneId, setSupplierPennylaneId] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferenceSearch, setPreferenceSearch] = useState("");
  const [clientFilterSearch, setClientFilterSearch] = useState("");
  const [supplierFilterSearch, setSupplierFilterSearch] = useState("");
  const [clientFilterNames, setClientFilterNames] = useState<string[]>([]);
  const [supplierFilterNames, setSupplierFilterNames] = useState<string[]>([]);
  const [preferenceDraft, setPreferenceDraft] = useState<string[]>([]);
  const [mode, setMode] = useState<"QUICK" | "DETAILED">("QUICK");
  const [description, setDescription] = useState("");
  const [allocations, setAllocations] = useState<QuickAllocation[]>([
    newAllocation(chantierId ?? ""),
  ]);
  const [lines, setLines] = useState<EditableLine[]>([newLine()]);
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState(chantierId ?? "ALL");
  const requestId = useRef<string>(crypto.randomUUID());

  async function reload() {
    const response = await fetch("/api/desktop/purchases", { cache: "no-store" });
    const json = (await response.json()) as Snapshot;
    if (!response.ok) throw new Error(json.error ?? "PURCHASE_ORDER_LOAD_FAILED");
    setSnapshot(json);
    return json;
  }
  useEffect(() => {
    void reload().catch(() => setError("Impossible de charger les bons de commande."));
  }, []);

  const allSites = snapshot?.chantiers ?? [];
  const sites = allSites.filter((site) => site.status === "ACTIVE");
  const matchingSites = sites.filter((site) =>
    [site.name, site.clientName, site.reference]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("fr-FR")
      .includes(siteQuery.trim().toLocaleLowerCase("fr-FR")),
  );
  const destinations = [
    ...sites.map((site) => ({
      id: site.id,
      label: [...new Set([site.reference, site.name, site.clientName].filter(Boolean))].join(" · "),
    })),
    { id: "SAV", label: "SAV (hors chantier)" },
    { id: "GENERAL_EXPENSES", label: "Frais généraux (hors chantier)" },
  ];
  const filteredDestinations = destinations.filter((item) =>
    item.label
      .toLocaleLowerCase("fr-FR")
      .includes(destinationQuery.trim().toLocaleLowerCase("fr-FR")),
  );
  const selected =
    sites.find((site) => site.id === siteId)?.id ??
    sites.find((site) => site.id === chantierId)?.id ??
    sites[0]?.id ??
    "";
  const preferenceSuppliers = snapshot?.supplierCatalog?.suppliers ?? [];
  const filteredPreferenceSuppliers = preferenceSuppliers.filter((supplier) =>
    supplier.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr-FR")
      .includes(
        preferenceSearch
          .trim()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase("fr-FR"),
      ),
  );
  const suppliers = useMemo(
    () =>
      [...new Set((snapshot?.payload.orders ?? []).map((order) => order.supplierName))].sort(
        (a, b) => a.localeCompare(b, "fr-FR"),
      ),
    [snapshot],
  );
  const linePreview = lines.map((line) => {
    const qty = positiveQuantity(line.quantity);
    const price = moneyCents(line.unitPrice);
    return qty !== null && price !== null ? Math.round(qty * price) : null;
  });
  const detailedTotal = linePreview.every((sum) => sum !== null)
    ? linePreview.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
    : null;
  const quickAmounts = allocations.map((entry) => moneyCents(entry.amount));
  const quickTotal =
    quickAmounts.every((value) => value !== null) && allocations.length > 0
      ? quickAmounts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null;
  const preview = mode === "QUICK" ? quickTotal : detailedTotal;
  const all = snapshot?.payload.orders ?? [];
  const clientByChantier = new Map(allSites.map((site) => [site.id, site.clientName]));
  const orderClients = (order: PurchaseOrder) => [
    ...new Set(
      purchaseOrderAllocations(order)
        .map((row) => clientByChantier.get(row.chantierId ?? ""))
        .filter((name): name is string => Boolean(name?.trim())),
    ),
  ];
  const orderClientNames = [...new Set(all.flatMap(orderClients))].sort((a, b) =>
    a.localeCompare(b, "fr-FR"),
  );
  const filteredOrderClients = orderClientNames.filter((name) =>
    name.toLocaleLowerCase("fr-FR").includes(clientFilterSearch.trim().toLocaleLowerCase("fr-FR")),
  );
  const filteredOrderSuppliers = suppliers.filter((name) =>
    name
      .toLocaleLowerCase("fr-FR")
      .includes(supplierFilterSearch.trim().toLocaleLowerCase("fr-FR")),
  );
  const visible = all
    .filter(
      (order) =>
        (supplierFilterNames.length === 0 || supplierFilterNames.includes(order.supplierName)) &&
        (clientFilterNames.length === 0 ||
          orderClients(order).some((client) => clientFilterNames.includes(client))),
    )
    .filter(
      (order) =>
        siteFilter === "ALL" ||
        (order.allocations?.some(
          (allocation) => purchaseDestinationKey(allocation) === siteFilter,
        ) ??
          order.chantierId === siteFilter),
    )
    .filter((order) =>
      [
        order.reference,
        order.supplierName,
        order.chantierName,
        ...(order.allocations?.map((a) => a.chantierName) ?? []),
        order.description,
      ]
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(search.trim().toLocaleLowerCase("fr-FR")),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function patchLine(id: string, key: keyof EditableLine, value: string) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, [key]: value } : line)),
    );
    setError("");
  }
  async function refreshSuppliers() {
    if (!snapshot?.canWrite || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REFRESH_SUPPLIERS" }),
      });
      const result = (await response.json()) as { error?: string; supplierCount?: number };
      if (!response.ok) throw new Error(result.error ?? "PURCHASE_SUPPLIER_REFRESH_FAILED");
      await reload();
      setNotice(String(result.supplierCount ?? 0) + " fournisseurs Pennylane actualisés.");
    } catch (cause) {
      setError(
        messageFor(cause instanceof Error ? cause.message : "PURCHASE_SUPPLIER_REFRESH_FAILED"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSupplierPreferences() {
    if (!snapshot?.canWrite || !snapshot.supplierCatalog?.synced || busy) return;
    if (
      preferenceDraft.length === 0 &&
      (snapshot.payload.supplierPreferences?.length ?? 0) > 0 &&
      !window.confirm("Retirer tous les fournisseurs des frais généraux par défaut ?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_SUPPLIER_PREFERENCES",
          supplierPennylaneIds: preferenceDraft,
        }),
      });
      const result = (await response.json()) as { payload?: PurchaseOrdersPayload; error?: string };
      if (!response.ok || !result.payload) {
        throw new Error(result.error ?? "Préférences non enregistrées.");
      }
      setSnapshot((old) => (old ? { ...old, payload: result.payload! } : old));
      setPreferencesOpen(false);
      setNotice("Affectations par défaut aux frais généraux enregistrées.");
    } catch (cause) {
      setError(messageFor(cause instanceof Error ? cause.message : "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!snapshot?.canWrite || busy) return;
    setError("");
    if (snapshot.supplierCatalog?.synced && !supplierPennylaneId) {
      setError(
        "Choisis un fournisseur Pennylane. Crée-le dans Pennylane puis actualise si nécessaire.",
      );
      return;
    }
    if (!supplierName.trim()) {
      setError("Renseigne le nom du fournisseur.");
      return;
    }
    let order: PurchaseOrderInput;
    if (mode === "QUICK") {
      const entries = allocations.map((row) => ({
        chantierId: row.chantierId || selected,
        amountHtCents: moneyCents(row.amount),
      }));
      if (
        entries.some((row) => !destinations.some((item) => item.id === row.chantierId)) ||
        entries.some((row) => row.amountHtCents === null || row.amountHtCents <= 0) ||
        new Set(entries.map((row) => row.chantierId)).size !== entries.length ||
        preview === null ||
        preview <= 0
      ) {
        setError("Indique une destination distincte et un montant HT positif sur chaque ligne.");
        return;
      }
      order = {
        mode: "QUICK",
        allocations: entries.map((row) =>
          purchaseAllocationFromSelection(row.chantierId, row.amountHtCents!),
        ),
        supplierName: supplierName.trim(),
        supplierPennylaneId: snapshot.supplierCatalog?.synced ? supplierPennylaneId : undefined,
        description: description.trim(),
      };
    } else {
      if (!selected) {
        setError("Choisis un chantier actif pour le BC détaillé.");
        return;
      }
      const parsed: PurchaseOrderLine[] = [];
      for (const line of lines) {
        const quantity = positiveQuantity(line.quantity);
        const unitPriceHtCents = moneyCents(line.unitPrice);
        if (
          !line.description.trim() ||
          !line.unit.trim() ||
          quantity === null ||
          unitPriceHtCents === null
        ) {
          setError("Chaque ligne doit avoir une désignation, quantité, unité et prix HT valides.");
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
      if (detailedTotal === null || detailedTotal <= 0 || !Number.isSafeInteger(detailedTotal)) {
        setError("Vérifie les prix : le total HT doit être positif.");
        return;
      }
      order = {
        mode: "DETAILED",
        chantierId: selected,
        supplierName: supplierName.trim(),
        supplierPennylaneId: snapshot.supplierCatalog?.synced ? supplierPennylaneId : undefined,
        description: description.trim(),
        lines: parsed,
      };
    }
    setBusy(true);
    try {
      const response = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CREATE", requestId: requestId.current, order }),
      });
      const result = (await response.json()) as Snapshot;
      if (!response.ok) throw new Error(result.error ?? "PURCHASE_ORDER_CREATE_FAILED");
      setSnapshot((current) => (current ? { ...current, payload: result.payload } : current));
      const saved = result.payload.orders.find((item) => item.requestId === requestId.current);
      setNotice(
        `${saved?.reference ?? "BC"} enregistré comme coût engagé, sans envoi au fournisseur.`,
      );
      requestId.current = crypto.randomUUID();
      setAllocations((rows) => rows.map((row) => ({ ...row, amount: "" })));
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
      const response = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", orderId: id, expectedUpdatedAt }),
      });
      const result = (await response.json()) as Snapshot;
      if (!response.ok) throw new Error(result.error ?? "PURCHASE_ORDER_CANCEL_FAILED");
      setSnapshot((current) => (current ? { ...current, payload: result.payload } : current));
      setNotice("BC annulé. Il n'est plus comptabilisé parmi les engagements.");
    } catch (e) {
      setError(messageFor(e instanceof Error ? e.message : "PURCHASE_ORDER_CANCEL_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 22, display: "grid", gap: 18, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 10 }}>
        <h1>Achats · Bons de commande</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Link href="/achats/factures" className="secondaryButton">
            Factures fournisseurs · Pennylane
          </Link>
          <button
            type="button"
            className="secondaryButton"
            disabled={!snapshot?.canWrite || busy}
            onClick={() => void refreshSuppliers()}
          >
            Actualiser les fournisseurs
          </button>
          <button
            type="button"
            className="secondaryButton"
            aria-expanded={preferencesOpen}
            disabled={!snapshot?.canWrite || !snapshot?.supplierCatalog?.synced || busy}
            onClick={() => {
              if (!preferencesOpen) {
                const allowed = new Set(
                  snapshot?.supplierCatalog?.suppliers.map((item) => item.id) ?? [],
                );
                setPreferenceDraft(
                  (snapshot?.payload.supplierPreferences ?? [])
                    .map((item) => item.supplierPennylaneId)
                    .filter((id) => allowed.has(id)),
                );
                setPreferenceSearch("");
              }
              setPreferencesOpen((open) => !open);
            }}
          >
            Fournisseurs · Frais généraux
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" style={{ color: "#b33138" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" style={{ color: "#327550" }}>
          {notice}
        </p>
      ) : null}
      {preferencesOpen && snapshot?.supplierCatalog?.synced ? (
        <section
          aria-label="Fournisseurs par défaut en frais généraux"
          style={{
            background: "white",
            padding: 18,
            borderRadius: 12,
            display: "grid",
            gap: 10,
            maxWidth: 760,
          }}
        >
          <h2>Fournisseurs affectés par défaut aux frais généraux</h2>
          <label style={{ display: "grid", gap: 5 }}>
            Rechercher des fournisseurs
            <input
              type="search"
              aria-label="Filtrer les fournisseurs pour frais généraux"
              placeholder="Tape un nom pour filtrer…"
              value={preferenceSearch}
              onChange={(event) => setPreferenceSearch(event.target.value)}
            />
          </label>
          <CheckboxChoiceList
            label="Fournisseurs affectés par défaut aux frais généraux"
            options={filteredPreferenceSuppliers.map((item) => ({ id: item.id, label: item.name }))}
            selectedIds={preferenceDraft}
            onChange={setPreferenceDraft}
            disabled={busy || !snapshot.canWrite}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="primaryButton"
              disabled={busy || !snapshot.canWrite}
              onClick={() => void saveSupplierPreferences()}
            >
              Enregistrer les préférences
            </button>
            <button
              type="button"
              className="secondaryButton"
              disabled={busy}
              onClick={() => setPreferencesOpen(false)}
            >
              Annuler
            </button>
          </div>
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
                <div style={{ display: "grid", gap: 5 }}>
                  <strong>Chantier / client *</strong>
                  <input
                    type="search"
                    aria-label="Rechercher un chantier pour le BC détaillé"
                    placeholder="Filtrer par chantier, client ou référence"
                    value={siteQuery}
                    onChange={(event) => setSiteQuery(event.target.value)}
                  />
                  <CheckboxChoiceList
                    label="Chantier du BC détaillé (choix unique)"
                    options={sites
                      .filter(
                        (site) =>
                          matchingSites.some((match) => match.id === site.id) ||
                          site.id === selected,
                      )
                      .map((site) => ({
                        id: site.id,
                        label: [site.reference, site.name, site.clientName]
                          .filter(Boolean)
                          .join(" · "),
                      }))}
                    selectedIds={selected ? [selected] : []}
                    multiple={false}
                    disabled={busy || !snapshot.canWrite}
                    onChange={(ids) => {
                      setSiteId(ids[0] ?? selected);
                      setError("");
                    }}
                  />
                </div>
              ) : null}
              <div style={{ display: "grid", gap: 5 }}>
                <strong>Fournisseur *</strong>
                {snapshot.supplierCatalog?.synced ? (
                  <PennylaneSupplierPicker
                    suppliers={snapshot.supplierCatalog.suppliers}
                    selectedId={supplierPennylaneId}
                    label="Fournisseur du BC"
                    disabled={busy || !snapshot.canWrite}
                    onChange={(id) => {
                      setSupplierPennylaneId(id);
                      setSupplierName(
                        snapshot.supplierCatalog?.suppliers.find((item) => item.id === id)?.name ??
                          "",
                      );
                      if (
                        snapshot.payload.supplierPreferences?.some(
                          (pref) =>
                            pref.supplierPennylaneId === id &&
                            pref.defaultDestination === "GENERAL_EXPENSES",
                        )
                      ) {
                        setMode("QUICK");
                        setAllocations([newAllocation("GENERAL_EXPENSES")]);
                        setNotice(
                          "Frais généraux proposés par défaut. Tu peux choisir un chantier exceptionnellement.",
                        );
                      }
                      setError("");
                    }}
                  />
                ) : (
                  <>
                    <input
                      aria-label="Fournisseur du BC"
                      list="bc-supplier-names"
                      maxLength={240}
                      placeholder="Nom du fournisseur"
                      value={supplierName}
                      disabled={busy || !snapshot.canWrite}
                      onChange={(event) => {
                        setSupplierName(event.target.value);
                        setError("");
                      }}
                    />
                    <datalist id="bc-supplier-names">
                      {suppliers.map((supplier) => (
                        <option key={supplier} value={supplier} />
                      ))}
                    </datalist>
                  </>
                )}
              </div>
            </div>
            <small>
              Fournisseur introuvable ? Crée-le dans Pennylane, puis clique sur « Actualiser les
              fournisseurs ».
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
                <input
                  type="search"
                  aria-label="Filtrer les destinations du BC"
                  placeholder="Filtrer les chantiers par nom, client ou référence"
                  value={destinationQuery}
                  onChange={(event) => setDestinationQuery(event.target.value)}
                />
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 630, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                        <th>Destination</th>
                        <th>Montant HT (€)</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((row, i) => {
                        const selectedDestination = row.chantierId || selected;
                        return (
                          <tr key={row.id}>
                            <td>
                              <select
                                aria-label={`Destination du BC rapide ligne ${i + 1}`}
                                value={selectedDestination}
                                disabled={busy || !snapshot.canWrite}
                                onChange={(e) => {
                                  setAllocations((current) =>
                                    current.map((item) =>
                                      item.id === row.id
                                        ? { ...item, chantierId: e.target.value }
                                        : item,
                                    ),
                                  );
                                  setError("");
                                }}
                                style={{ width: "100%", minWidth: 210 }}
                              >
                                <option value="">Choisir une destination</option>
                                {!destinations.some((item) => item.id === selectedDestination) &&
                                selectedDestination ? (
                                  <option value={selectedDestination} disabled>
                                    Chantier indisponible : choisir une destination
                                  </option>
                                ) : null}
                                {destinations
                                  .filter(
                                    (item) =>
                                      item.id === selectedDestination ||
                                      filteredDestinations.some((match) => match.id === item.id),
                                  )
                                  .map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`Montant HT ligne chantier, SAV ou frais généraux ${i + 1}`}
                                inputMode="decimal"
                                placeholder="Ex. 250,00"
                                value={row.amount}
                                disabled={busy || !snapshot.canWrite}
                                onChange={(e) => {
                                  setAllocations((current) =>
                                    current.map((item) =>
                                      item.id === row.id
                                        ? { ...item, amount: e.target.value }
                                        : item,
                                    ),
                                  );
                                  setError("");
                                }}
                                onBlur={() =>
                                  setAllocations((current) =>
                                    current.map((item) =>
                                      item.id === row.id
                                        ? {
                                            ...item,
                                            amount: numericExpressionInput(item.amount, 2),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                                style={{ width: 135 }}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="secondaryButton"
                                disabled={allocations.length === 1 || busy || !snapshot.canWrite}
                                onClick={() =>
                                  setAllocations((current) =>
                                    current.filter((item) => item.id !== row.id),
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
                <PurchaseDestinationMultiPicker
                  label="Chantiers ou destinations à ajouter au BC"
                  options={filteredDestinations.filter(
                    (item) => !allocations.some((row) => (row.chantierId || selected) === item.id),
                  )}
                  selectedIds={extraDestinations}
                  onChange={setExtraDestinations}
                  disabled={busy || !snapshot.canWrite || allocations.length >= 100}
                />
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={
                    busy ||
                    !snapshot.canWrite ||
                    allocations.length >= 100 ||
                    extraDestinations.length === 0
                  }
                  onClick={() => {
                    const ids = extraDestinations.filter(
                      (id) =>
                        destinations.some((item) => item.id === id) &&
                        !allocations.some((row) => (row.chantierId || selected) === id),
                    );
                    if (ids.length) {
                      setAllocations((current) => [
                        ...current,
                        ...ids.slice(0, 100 - current.length).map((id) => newAllocation(id)),
                      ]);
                    }
                    setExtraDestinations([]);
                  }}
                >
                  Ajouter les destinations sélectionnées ({extraDestinations.length})
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
                    {lines.map((line, i) => (
                      <tr key={line.id}>
                        <td>
                          <input
                            aria-label={`Désignation ligne ${i + 1}`}
                            value={line.description}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(line.id, "description", e.target.value)}
                            style={{ width: "100%", minWidth: 230 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Quantité ligne ${i + 1}`}
                            inputMode="decimal"
                            value={line.quantity}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(line.id, "quantity", e.target.value)}
                            onBlur={() =>
                              patchLine(
                                line.id,
                                "quantity",
                                numericExpressionInput(line.quantity, 6, 0.000001, 1_000_000),
                              )
                            }
                            style={{ width: 80 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Unité ligne ${i + 1}`}
                            value={line.unit}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(line.id, "unit", e.target.value)}
                            style={{ width: 75 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Prix unitaire ligne ${i + 1}`}
                            inputMode="decimal"
                            value={line.unitPrice}
                            disabled={busy || !snapshot.canWrite}
                            onChange={(e) => patchLine(line.id, "unitPrice", e.target.value)}
                            onBlur={() =>
                              patchLine(
                                line.id,
                                "unitPrice",
                                numericExpressionInput(line.unitPrice, 2),
                              )
                            }
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
                            disabled={lines.length === 1 || busy || !snapshot.canWrite}
                            onClick={() =>
                              setLines((current) => current.filter((x) => x.id !== line.id))
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
                  disabled={busy || !snapshot.canWrite || lines.length >= 200}
                  onClick={() => setLines((current) => [...current, newLine()])}
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
                <strong>Total du BC : {preview === null ? "À renseigner" : euro(preview)}</strong>
                <div>Les montants sont engagés une seule fois selon les destinations.</div>
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
                value={search}
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
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                Filtres clients et fournisseurs
                {clientFilterNames.length + supplierFilterNames.length > 0
                  ? ` (${clientFilterNames.length + supplierFilterNames.length} cochés)`
                  : ""}
              </summary>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 14,
                  marginTop: 12,
                }}
              >
                <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                  <strong>Clients des commandes</strong>
                  <input
                    type="search"
                    aria-label="Filtrer les clients des commandes"
                    placeholder="Tape le nom du client…"
                    value={clientFilterSearch}
                    onChange={(event) => setClientFilterSearch(event.target.value)}
                  />
                  <CheckboxChoiceList
                    label="Clients des commandes"
                    options={filteredOrderClients.map((name) => ({ id: name, label: name }))}
                    selectedIds={clientFilterNames}
                    onChange={setClientFilterNames}
                  />
                </div>
                <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                  <strong>Fournisseurs des commandes</strong>
                  <input
                    type="search"
                    aria-label="Filtrer les fournisseurs des commandes"
                    placeholder="Tape le nom du fournisseur…"
                    value={supplierFilterSearch}
                    onChange={(event) => setSupplierFilterSearch(event.target.value)}
                  />
                  <CheckboxChoiceList
                    label="Fournisseurs des commandes"
                    options={filteredOrderSuppliers.map((name) => ({ id: name, label: name }))}
                    selectedIds={supplierFilterNames}
                    onChange={setSupplierFilterNames}
                  />
                </div>
              </div>
            </details>
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
                  {visible.map((order) => (
                    <tr key={order.id} style={{ borderBottom: "1px solid #ece8f0" }}>
                      <td style={{ padding: 8 }}>{order.reference}</td>
                      <td style={{ padding: 8 }}>
                        {new Date(order.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 8 }}>{order.supplierName}</td>
                      <td style={{ padding: 8 }}>
                        {order.allocations?.length ? (
                          <details>
                            <summary>{order.allocations.length} destination(s)</summary>
                            {order.allocations.map((a) => (
                              <div key={purchaseDestinationKey(a)}>
                                {a.chantierName} : {euro(a.amountHtCents)}
                              </div>
                            ))}
                          </details>
                        ) : (
                          order.chantierName
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {order.mode === "QUICK" ? "Rapide" : `Détaillé (${order.lines.length})`}
                      </td>
                      <td style={{ padding: 8 }}>
                        {order.status === "CANCELLED" ? "Annulé" : "Engagé · Non envoyé"}
                      </td>
                      <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                        {euro(order.amountHtCents)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {order.status === "COMMITTED" &&
                        snapshot.canWrite &&
                        !order.removedAllocations?.length ? (
                          <Link
                            className="secondaryButton"
                            href={`/achats/${encodeURIComponent(order.id)}/modifier`}
                          >
                            Modifier
                          </Link>
                        ) : null}
                        {order.status === "COMMITTED" && snapshot.canWrite ? (
                          <button
                            type="button"
                            className="secondaryButton"
                            disabled={busy}
                            onClick={() => void cancel(order.id, order.updatedAt)}
                          >
                            Annuler
                          </button>
                        ) : null}
                        {order.mode === "DETAILED" ? (
                          <>
                            <a
                              className="secondaryButton"
                              href={`/api/desktop/purchases/${encodeURIComponent(order.id)}/pdf`}
                              aria-label={`Télécharger le PDF du ${order.reference}`}
                            >
                              PDF
                            </a>
                            <details>
                              <summary>Lignes</summary>
                              {order.lines.map((line) => (
                                <div key={line.id}>
                                  {line.description} · {line.quantity} {line.unit} ×{" "}
                                  {euro(line.unitPriceHtCents)}
                                </div>
                              ))}
                            </details>
                          </>
                        ) : order.description ? (
                          <small>{order.description}</small>
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
