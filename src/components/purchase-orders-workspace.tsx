"use client";

import Link from "next/link";
import { evaluateNumericExpression, numericExpressionInput } from "@/lib/numeric-expression";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PurchaseOrderInput,
  PurchaseOrderLine,
  PurchaseOrdersPayload,
} from "@/lib/purchases/domain";
import { purchaseAllocationFromSelection, purchaseDestinationKey } from "@/lib/purchases/domain";

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
    ...sites.map((site) => ({ id: site.id, label: `${site.name} · ${site.clientName ?? ""}` })),
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
  const visible = all
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

  async function setSupplierPreference(supplierId: string, defaultGeneralExpenses: boolean) {
    if (!snapshot?.canWrite || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_SUPPLIER_PREFERENCE",
          supplierPennylaneId: supplierId,
          defaultGeneralExpenses,
        }),
      });
      const result = (await response.json()) as { payload?: PurchaseOrdersPayload; error?: string };
      if (!response.ok || !result.payload) throw new Error(result.error ?? "Réglage impossible");
      setSnapshot((old) => (old ? { ...old, payload: result.payload! } : old));
      setNotice("Préférence fournisseur enregistrée dans PAPOT.");
    } catch (cause) {
      setError(messageFor(cause instanceof Error ? cause.message : "Réglage impossible"));
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
      <div>
        <h1>Achats · Bons de commande</h1>
        <Link href="/achats/factures" className="secondaryButton">
          Factures fournisseurs · Pennylane
        </Link>
        <p>
          Un BC enregistré est un <strong>coût engagé HT</strong>. Il ne crée ni facture
          fournisseur, ni coût réel validé, ni envoi automatique. Rapprochement Pennylane à venir.
        </p>
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
                  <input
                    type="search"
                    aria-label="Rechercher un chantier pour le BC détaillé"
                    placeholder="Filtrer par chantier, client ou référence"
                    value={siteQuery}
                    onChange={(event) => setSiteQuery(event.target.value)}
                  />
                  <select
                    value={selected}
                    disabled={busy || !snapshot.canWrite}
                    onChange={(e) => {
                      setSiteId(e.target.value);
                      setError("");
                    }}
                  >
                    {sites.length === 0 ? <option value="">Aucun chantier actif</option> : null}
                    {sites
                      .filter(
                        (site) =>
                          matchingSites.some((match) => match.id === site.id) ||
                          site.id === selected,
                      )
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name} · {site.clientName}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <label style={{ display: "grid", gap: 5 }}>
                Fournisseur *
                {snapshot.supplierCatalog?.synced ? (
                  <select
                    aria-label="Fournisseur du BC"
                    value={supplierPennylaneId}
                    disabled={busy || !snapshot.canWrite}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSupplierPennylaneId(id);
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
                          "Fournisseur FG : frais généraux proposés par défaut. Tu peux changer la destination pour une exception.",
                        );
                      }
                      setSupplierName(
                        snapshot.supplierCatalog?.suppliers.find((item) => item.id === id)?.name ??
                          "",
                      );
                      setError("");
                    }}
                  >
                    <option value="">Sélectionner dans Pennylane</option>
                    {snapshot.supplierCatalog.suppliers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
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
              </label>
            </div>
            <small>
              {snapshot.supplierCatalog?.synced
                ? "Fournisseur absent ? Crée-le dans Pennylane puis clique sur Actualiser."
                : "Liste Pennylane non synchronisée : les anciens noms des BC restent provisoirement utilisables."}
            </small>
            <div>
              <button
                type="button"
                className="secondaryButton"
                disabled={busy || !snapshot.canWrite || !snapshot.supplierCatalog}
                onClick={() => void refreshSuppliers()}
              >
                Actualiser les fournisseurs
              </button>
              <small>
                {" "}
                La récupération exige la clé Pennylane et l&apos;autorisation d&apos;import serveur.
              </small>
            </div>
            {snapshot.supplierCatalog?.synced ? (
              <div style={{ display: "grid", gap: 8 }}>
                <button
                  type="button"
                  className="secondaryButton"
                  aria-expanded={preferencesOpen}
                  onClick={() => setPreferencesOpen((open) => !open)}
                >
                  Paramétrer les fournisseurs affectés par défaut aux frais généraux
                </button>
                {preferencesOpen ? (
                  <div
                    style={{
                      maxHeight: 300,
                      overflowY: "auto",
                      padding: 12,
                      border: "1px solid #ddd",
                    }}
                  >
                    <p>
                      Préférence PAPOT uniquement. Les fiches fournisseurs restent gérées dans
                      Pennylane.
                    </p>
                    {snapshot.supplierCatalog.suppliers.map((item) => (
                      <label
                        key={item.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Affectation FG par défaut pour ${item.name}`}
                          checked={Boolean(
                            snapshot.payload.supplierPreferences?.some(
                              (pref) => pref.supplierPennylaneId === item.id,
                            ),
                          )}
                          disabled={busy || !snapshot.canWrite}
                          onChange={(event) =>
                            void setSupplierPreference(item.id, event.target.checked)
                          }
                        />
                        {item.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {filteredDestinations
                    .filter(
                      (item) =>
                        !allocations.some((row) => (row.chantierId || selected) === item.id),
                    )
                    .slice(0, 25)
                    .map((item) => (
                      <label
                        key={item.id}
                        style={{ display: "flex", gap: 5, alignItems: "center" }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Ajouter ${item.label}`}
                          checked={extraDestinations.includes(item.id)}
                          disabled={busy || !snapshot.canWrite}
                          onChange={(event) =>
                            setExtraDestinations((old) =>
                              event.target.checked
                                ? [...new Set([...old, item.id])]
                                : old.filter((id) => id !== item.id),
                            )
                          }
                        />
                        {item.label}
                      </label>
                    ))}
                </div>
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={busy || !snapshot.canWrite || allocations.length >= 100}
                  onClick={() => {
                    const toAdd = extraDestinations.filter(
                      (id) =>
                        destinations.some((item) => item.id === id) &&
                        !allocations.some((row) => (row.chantierId || selected) === id),
                    );
                    const defaultNext = filteredDestinations.find(
                      (item) =>
                        !allocations.some((row) => (row.chantierId || selected) === item.id),
                    );
                    const ids = toAdd.length ? toAdd : defaultNext ? [defaultNext.id] : [];
                    if (ids.length)
                      setAllocations((current) => [
                        ...current,
                        ...ids.slice(0, 100 - current.length).map((id) => newAllocation(id)),
                      ]);
                    else setError("Toutes les destinations proposées sont déjà sélectionnées.");
                    setExtraDestinations([]);
                  }}
                >
                  Ajouter les destinations sélectionnées ({extraDestinations.length || 1})
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
