"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { purchaseOrderAllocations, type PurchaseOrder } from "@/lib/purchases/domain";
import {
  calculateInvoiceAllocation,
  distributeCharge,
  destinationKey,
  type InvoiceAllocationDraft,
  type InvoiceDestination,
} from "@/lib/pennylane/purchase-allocations";
import type { PurchaseInvoiceWorkspaceData } from "@/lib/pennylane/purchase-invoice-store";

type ResponseBody = PurchaseInvoiceWorkspaceData & { canWrite: boolean; error?: string };
type Line = { id: string; label: string; amountHtCents: number | null };

const money = (value: number | null) =>
  value === null
    ? "Indisponible"
    : (value / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const numberValue = (value: number) => value / 100;
function fromInput(value: string) {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function emptyDraft(): InvoiceAllocationDraft {
  return { mode: "GLOBAL", rows: [], charges: [], orderLinks: [], note: "" };
}
function rowDestination(choice: string): InvoiceDestination {
  return choice === "SAV" || choice === "GENERAL_EXPENSES"
    ? { kind: choice, chantierId: null }
    : { kind: "CHANTIER", chantierId: choice };
}
function description(code: string) {
  const text: Record<string, string> = {
    INVOICE_ALLOCATION_INCOMPLETE:
      "Le total réparti doit correspondre exactement au montant HT de la facture.",
    INVOICE_VERSION_CONFLICT:
      "Cette facture a été modifiée par un autre utilisateur. Recharge la page.",
    INVOICE_SOURCE_CHANGED:
      "La facture a changé dans Pennylane. Actualise les factures avant de reprendre.",
    INVOICE_POSSIBLE_DUPLICATE:
      "Doublon potentiel : vérifie cette facture dans Pennylane avant de valider.",
    INVOICE_CHANTIER_NOT_FOUND: "Un chantier de cette ventilation n'existe plus.",
    INVOICE_ORDER_NOT_FOUND: "Un bon de commande sélectionné n'est plus disponible.",
    PENNYLANE_DISABLED: "L'import Pennylane n'est pas encore activé sur le serveur.",
  };
  return text[code] ?? "Opération impossible (" + code + ").";
}

export function PurchaseInvoicesWorkspace() {
  const [data, setData] = useState<ResponseBody | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<InvoiceAllocationDraft>(emptyDraft);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/desktop/purchase-invoices", { cache: "no-store" });
    const body = (await response.json()) as ResponseBody;
    if (!response.ok) throw new Error(body.error ?? "INVOICE_LOAD_FAILED");
    setData(body);
    setSelectedId((id) =>
      body.invoices.some((item) => item.id === id) ? id : (body.invoices[0]?.id ?? ""),
    );
  }
  useEffect(() => {
    void load().catch(() => setError("Impossible de charger les factures fournisseurs."));
  }, []);

  const selected = data?.invoices.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    setDraft(selected?.state?.draft ?? emptyDraft());
    setLines([]);
    if (!selected) return;
    void fetch("/api/desktop/purchase-invoices/" + selected.id, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("LINES_UNAVAILABLE");
        return response.json() as Promise<{ lines: Line[] }>;
      })
      .then((body) => setLines(body.lines))
      .catch(() => setLines([]));
  }, [selected?.id, selected?.state?.version]);

  const destinationOptions = [
    ...(data?.chantiers ?? []).map((site) => ({
      value: site.id,
      label: site.name + (site.status !== "ACTIVE" ? " (chantier clôturé)" : ""),
    })),
    { value: "SAV", label: "SAV" },
    { value: "GENERAL_EXPENSES", label: "Frais généraux" },
  ];
  const calculation = useMemo(() => {
    try {
      return calculateInvoiceAllocation(draft);
    } catch {
      return null;
    }
  }, [draft]);
  const complete =
    selected?.amountHtCents !== null &&
    calculation !== null &&
    calculation.destinations.length > 0 &&
    calculation.totalHtCents === selected?.amountHtCents &&
    (draft.mode === "GLOBAL" || draft.rows.every((row) => row.sourceLineId !== null));
  const visibleInvoices = (data?.invoices ?? []).filter((invoice) =>
    [invoice.supplierName, invoice.invoiceNumber, invoice.invoiceDate ?? ""]
      .join(" ")
      .toLocaleLowerCase("fr-FR")
      .includes(search.toLocaleLowerCase("fr-FR")),
  );

  function editRow(id: string, update: Partial<InvoiceAllocationDraft["rows"][number]>) {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.id === id ? { ...row, ...update } : row)),
    }));
  }
  function addRow() {
    const first =
      data?.chantiers.find((site) => site.status === "ACTIVE")?.id ?? "GENERAL_EXPENSES";
    setDraft((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          id: crypto.randomUUID(),
          sourceLineId: null,
          destination: rowDestination(first),
          amountHtCents: 0,
        },
      ],
    }));
  }
  function applyOrder(order: PurchaseOrder) {
    if (draft.orderLinks.some((link) => link.orderId === order.id)) return;
    const links = purchaseOrderAllocations(order);
    const balance = data?.orderBalances[order.id];
    if (balance?.settled) {
      setError("Ce bon de commande est soldé. Corrige d'abord le rapprochement précédent.");
      return;
    }
    const toApply = balance ? balance.remainingHtCents : order.amountHtCents;
    if (toApply <= 0) {
      setError("Ce bon de commande est déjà intégralement facturé.");
      return;
    }
    const shares = distributeCharge(
      toApply,
      links.map((link, index) => ({ key: String(index), weight: link.amountHtCents })),
    );
    setDraft((current) => ({
      ...current,
      rows: [
        ...current.rows,
        ...links.map((link, index) => ({
          id: crypto.randomUUID(),
          sourceLineId: null,
          destination: {
            kind: link.destinationType ?? "CHANTIER",
            chantierId: link.chantierId,
          } as InvoiceDestination,
          amountHtCents: shares.get(String(index)) ?? 0,
        })),
      ],
      orderLinks: [
        ...current.orderLinks,
        {
          orderId: order.id,
          appliedHtCents: toApply,
          settle: false,
        },
      ],
    }));
    setNotice("Répartition du BC reprise. Vérifie les montants et les éventuels frais.");
  }
  async function mutate(action: "SAVE" | "VALIDATE" | "REFRESH") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        action === "REFRESH"
          ? { action }
          : {
              action,
              invoiceId: selected?.id,
              expectedVersion: selected?.state?.version ?? 0,
              expectedRevision: selected?.sourceRevision,
              draft,
            };
      const response = await fetch("/api/desktop/purchase-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "INVOICE_SAVE_FAILED");
      await load();
      setNotice(
        action === "REFRESH"
          ? "Les données Pennylane ont été actualisées."
          : action === "SAVE"
            ? "Brouillon enregistré. L'affectation peut être reprise plus tard."
            : "Affectation PAPOT validée. Le coût réel attend aussi la validation comptable Pennylane.",
      );
    } catch (cause) {
      setError(description(cause instanceof Error ? cause.message : "INVOICE_SAVE_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 20, maxWidth: 1740, margin: "0 auto", display: "grid", gap: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <h1>Achats · Factures fournisseurs</h1>
          <p>Rapprocher la facture aux commandes, répartir les frais et valider les coûts HT.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="secondaryButton" href="/achats">
            Bons de commande
          </Link>
          <button
            type="button"
            className="secondaryButton"
            disabled={busy || !data?.canWrite || !data?.importEnabled}
            onClick={() => void mutate("REFRESH")}
          >
            Actualiser Pennylane
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert" style={{ color: "#ac293b" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" style={{ color: "#256c49" }}>
          {notice}
        </p>
      ) : null}
      <p style={{ fontSize: 13, color: "#615976" }}>
        Dernier import :{" "}
        {data?.lastImportedAt ? new Date(data.lastImportedAt).toLocaleString("fr-FR") : "Aucun"}.
        {!data?.importEnabled
          ? " Synchronisation désactivée : activation serveur nécessaire après tests de la clé."
          : ""}
        {data?.truncated ? " Liste limitée à 500 factures : prévoir une recherche paginée." : ""}
      </p>
      {!data ? (
        <p>Chargement…</p>
      ) : data.invoices.length === 0 ? (
        <section style={{ background: "white", padding: 24, borderRadius: 12 }}>
          <h2>Aucune facture importée</h2>
          <p>
            Après configuration de la nouvelle clé dans Paramètres → Pennylane, l&apos;import en
            lecture seule pourra alimenter cette liste.
          </p>
          <Link href="/settings/pennylane" className="secondaryButton">
            Paramètres Pennylane
          </Link>
        </section>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(215px, 0.65fr) minmax(340px, 1.2fr) minmax(355px, 1.35fr)",
            gap: 12,
            alignItems: "start",
            overflowX: "auto",
          }}
        >
          <section
            style={{
              background: "white",
              borderRadius: 12,
              padding: 12,
              display: "grid",
              gap: 9,
              minWidth: 215,
            }}
          >
            <h2>Factures ({visibleInvoices.length})</h2>
            <input
              aria-label="Rechercher une facture"
              placeholder="Fournisseur, numéro, date…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div style={{ maxHeight: "75vh", overflow: "auto", display: "grid", gap: 6 }}>
              {visibleInvoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(invoice.id);
                    setNotice("");
                    setError("");
                  }}
                  style={{
                    textAlign: "left",
                    background: selectedId === invoice.id ? "#eee8fb" : "#faf9fd",
                    border: selectedId === invoice.id ? "1px solid #a999e4" : "1px solid #e6e0ef",
                    borderRadius: 8,
                    padding: 10,
                    cursor: "pointer",
                    display: "grid",
                    gap: 3,
                  }}
                >
                  <strong>{invoice.supplierName}</strong>
                  <small>
                    {invoice.invoiceNumber || "Sans numéro"} · {money(invoice.amountHtCents)} HT
                  </small>
                  <small>
                    {invoice.workflow === "VALIDATED"
                      ? "✓ Validée"
                      : invoice.workflow === "AWAITING_PENNYLANE"
                        ? "En attente de Pennylane"
                        : invoice.workflow === "REVALIDATION"
                          ? "⚠ À revalider"
                          : invoice.workflow === "DRAFT"
                            ? "Brouillon"
                            : "À affecter"}
                    {invoice.duplicateIds.length ? " · Doublon suspect" : ""}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <section
            style={{
              background: "white",
              borderRadius: 12,
              padding: 14,
              display: "grid",
              gap: 10,
              minWidth: 340,
            }}
          >
            {selected ? (
              <>
                <h2>Facture {selected.invoiceNumber || selected.id}</h2>
                <div>
                  {selected.supplierName} · {selected.invoiceDate ?? "Sans date"}
                </div>
                <div>
                  <strong>{money(selected.amountHtCents)} HT</strong> · Pennylane :{" "}
                  {selected.accountingStatus}
                </div>
                {selected.duplicateIds.length ? (
                  <p style={{ color: "#a43a26" }}>
                    Doublon potentiel avec la facture {selected.duplicateIds.join(", ")}. La
                    validation est bloquée jusqu&apos;à résolution.
                  </p>
                ) : null}
                {selected.hasPdf ? (
                  <>
                    <a
                      href={"/api/desktop/purchase-invoices/" + selected.id + "/pdf"}
                      target="_blank"
                      rel="noreferrer"
                      className="secondaryButton"
                    >
                      Ouvrir le PDF dans un nouvel onglet
                    </a>
                    <iframe
                      title="Facture fournisseur Pennylane"
                      src={"/api/desktop/purchase-invoices/" + selected.id + "/pdf"}
                      style={{
                        width: "100%",
                        height: "60vh",
                        border: "1px solid #e3dcea",
                        borderRadius: 8,
                      }}
                    />
                  </>
                ) : (
                  <p>Document PDF non disponible dans Pennylane.</p>
                )}
                <small>
                  Le lien PDF est renouvelé lors de chaque ouverture. Si l&apos;aperçu est bloqué
                  par le navigateur, utilise « Ouvrir le PDF ».
                </small>
              </>
            ) : null}
          </section>
          <section
            style={{
              background: "white",
              borderRadius: 12,
              padding: 14,
              display: "grid",
              gap: 12,
              minWidth: 355,
            }}
          >
            <h2>Affectation Nadia</h2>
            {selected ? (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={draft.mode === "GLOBAL" ? "primaryButton" : "secondaryButton"}
                    disabled={busy}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        mode: "GLOBAL",
                        rows: current.rows.map((row) => ({ ...row, sourceLineId: null })),
                      }))
                    }
                  >
                    Montants globaux
                  </button>
                  <button
                    type="button"
                    className={draft.mode === "LINES" ? "primaryButton" : "secondaryButton"}
                    disabled={busy}
                    onClick={() => setDraft((current) => ({ ...current, mode: "LINES" }))}
                  >
                    Ligne par ligne
                  </button>
                </div>
                <h3>Bons de commande proposés</h3>
                {selected.proposedOrders.length === 0 ? (
                  <p>Aucun BC correspondant. Affectation manuelle possible.</p>
                ) : null}
                {selected.proposedOrders.map((proposal) => {
                  const order = data.orders.find((candidate) => candidate.id === proposal.id);
                  const link = draft.orderLinks.find((item) => item.orderId === proposal.id);
                  return (
                    <div
                      key={proposal.id}
                      style={{
                        border: "1px solid #e8e0ee",
                        borderRadius: 8,
                        padding: 9,
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <strong>
                        {proposal.reference} · {proposal.chantierName}
                      </strong>
                      <small>BC : {money(proposal.amountHtCents)} HT</small>
                      <small>
                        Déjà rapproché :{" "}
                        {money(data.orderBalances[proposal.id]?.billedHtCents ?? 0)} · Reste :{" "}
                        {money(
                          data.orderBalances[proposal.id]?.remainingHtCents ??
                            proposal.amountHtCents,
                        )}
                        {data.orderBalances[proposal.id]?.settled ? " · BC soldé" : ""}
                      </small>
                      {link ? (
                        <>
                          <label>
                            Part rapprochée HT (€)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={numberValue(link.appliedHtCents)}
                              disabled={busy || !data.canWrite}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  orderLinks: current.orderLinks.map((item) =>
                                    item.orderId === proposal.id
                                      ? {
                                          ...item,
                                          appliedHtCents: Math.max(
                                            0,
                                            fromInput(event.target.value),
                                          ),
                                        }
                                      : item,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={link.settle}
                              disabled={busy || !data.canWrite}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  orderLinks: current.orderLinks.map((item) =>
                                    item.orderId === proposal.id
                                      ? { ...item, settle: event.target.checked }
                                      : item,
                                  ),
                                }))
                              }
                            />{" "}
                            Solder le BC après cette facture
                          </label>
                          <button
                            className="secondaryButton"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                orderLinks: current.orderLinks.filter(
                                  (item) => item.orderId !== proposal.id,
                                ),
                              }))
                            }
                          >
                            Dissocier ce BC
                          </button>
                        </>
                      ) : (
                        <button
                          className="secondaryButton"
                          type="button"
                          disabled={
                            busy ||
                            !data.canWrite ||
                            !order ||
                            Boolean(data.orderBalances[proposal.id]?.settled)
                          }
                          onClick={() => order && applyOrder(order)}
                        >
                          Reprendre cette commande
                        </button>
                      )}
                    </div>
                  );
                })}
                <h3>Répartition HT</h3>
                {draft.rows.map((row, index) => (
                  <div
                    key={row.id}
                    style={{
                      display: "grid",
                      gap: 5,
                      border: "1px solid #e7e1f0",
                      padding: 9,
                      borderRadius: 8,
                    }}
                  >
                    <strong>Affectation {index + 1}</strong>
                    {draft.mode === "LINES" ? (
                      <label>
                        Ligne de la facture
                        <select
                          value={row.sourceLineId ?? ""}
                          disabled={busy || !data.canWrite}
                          onChange={(event) =>
                            editRow(row.id, { sourceLineId: event.target.value || null })
                          }
                        >
                          <option value="">Sélectionner la ligne</option>
                          {lines.map((line) => (
                            <option key={line.id} value={line.id}>
                              {line.label}{" "}
                              {line.amountHtCents !== null ? "· " + money(line.amountHtCents) : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label>
                      Destination
                      <select
                        value={
                          row.destination.kind === "CHANTIER"
                            ? (row.destination.chantierId ?? "")
                            : row.destination.kind
                        }
                        disabled={busy || !data.canWrite}
                        onChange={(event) =>
                          editRow(row.id, { destination: rowDestination(event.target.value) })
                        }
                      >
                        {destinationOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Montant achats HT (€)
                      <input
                        type="number"
                        step="0.01"
                        value={numberValue(row.amountHtCents)}
                        disabled={busy || !data.canWrite}
                        onChange={(event) =>
                          editRow(row.id, { amountHtCents: fromInput(event.target.value) })
                        }
                      />
                    </label>
                    <button
                      className="secondaryButton"
                      type="button"
                      disabled={busy || !data.canWrite}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          rows: current.rows.filter((item) => item.id !== row.id),
                        }))
                      }
                    >
                      Retirer cette affectation
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={busy || !data.canWrite}
                  onClick={addRow}
                >
                  + Ajouter un chantier / SAV / frais généraux
                </button>
                <h3>Frais annexes et remises</h3>
                {draft.charges.map((charge) => (
                  <div
                    key={charge.id}
                    style={{
                      display: "grid",
                      gap: 5,
                      border: "1px solid #e7e1f0",
                      borderRadius: 8,
                      padding: 9,
                    }}
                  >
                    <label>
                      Nature du frais ou de la remise
                      <input
                        value={charge.label}
                        maxLength={180}
                        disabled={busy || !data.canWrite}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            charges: current.charges.map((item) =>
                              item.id === charge.id ? { ...item, label: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Montant HT (€), remise en négatif
                      <input
                        type="number"
                        step="0.01"
                        value={numberValue(charge.amountHtCents)}
                        disabled={busy || !data.canWrite}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            charges: current.charges.map((item) =>
                              item.id === charge.id
                                ? { ...item, amountHtCents: fromInput(event.target.value) }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Répartir au prorata sur
                      <select
                        disabled={busy || !data.canWrite}
                        value={charge.destinationKeys[0] ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            charges: current.charges.map((item) =>
                              item.id === charge.id
                                ? {
                                    ...item,
                                    destinationKeys: event.target.value ? [event.target.value] : [],
                                  }
                                : item,
                            ),
                          }))
                        }
                      >
                        <option value="">Tous les chantiers concernés</option>
                        {calculation?.destinations.map((item) => (
                          <option
                            key={destinationKey(item.destination)}
                            value={destinationKey(item.destination)}
                          >
                            {item.destination.kind === "CHANTIER"
                              ? (data.chantiers.find(
                                  (site) => site.id === item.destination.chantierId,
                                )?.name ?? "Chantier")
                              : item.destination.kind === "SAV"
                                ? "SAV"
                                : "Frais généraux"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={busy || !data.canWrite}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          charges: current.charges.filter((item) => item.id !== charge.id),
                        }))
                      }
                    >
                      Retirer ce frais
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={busy || !data.canWrite}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      charges: [
                        ...current.charges,
                        {
                          id: crypto.randomUUID(),
                          label: "Livraison",
                          amountHtCents: 0,
                          destinationKeys: [],
                        },
                      ],
                    }))
                  }
                >
                  + Livraison / emballage / remise / autre
                </button>
                <label>
                  Note interne
                  <textarea
                    value={draft.note}
                    rows={2}
                    maxLength={2000}
                    disabled={busy || !data.canWrite}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, note: event.target.value }))
                    }
                  />
                </label>
                <section style={{ background: "#f5f2fb", padding: 12, borderRadius: 9 }}>
                  <div>
                    Total facture : <strong>{money(selected.amountHtCents)}</strong>
                  </div>
                  <div>
                    Total affecté :{" "}
                    <strong>
                      {calculation ? money(calculation.totalHtCents) : "Répartition à corriger"}
                    </strong>
                  </div>
                  <div>
                    Reste :{" "}
                    <strong>
                      {selected.amountHtCents !== null && calculation
                        ? money(selected.amountHtCents - calculation.totalHtCents)
                        : "Indisponible"}
                    </strong>
                  </div>
                  {calculation?.destinations.map((item) => (
                    <small key={destinationKey(item.destination)} style={{ display: "block" }}>
                      {item.destination.kind === "CHANTIER"
                        ? (data.chantiers.find((site) => site.id === item.destination.chantierId)
                            ?.name ?? "Chantier")
                        : item.destination.kind === "SAV"
                          ? "SAV"
                          : "Frais généraux"}{" "}
                      : {money(item.totalHtCents)}
                      {" (dont " + money(item.chargesHtCents) + " de frais/remises)"}
                    </small>
                  ))}
                </section>
                {selected.state?.history.length ? (
                  <details>
                    <summary>Historique des affectations ({selected.state.history.length})</summary>
                    <ul>
                      {selected.state.history.map((event, index) => (
                        <li key={event.version + "-" + index}>
                          {new Date(event.at).toLocaleString("fr-FR")} · {event.actor} ·
                          {event.action === "VALIDATE" ? " Validation" : " Brouillon"}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {selected.workflow === "REVALIDATION" ? (
                  <p role="alert">
                    Facture ou affectation modifiée : la dernière validation reste en référence
                    provisoire jusqu&apos;à nouvelle validation.
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !data.canWrite}
                    onClick={() => void mutate("SAVE")}
                  >
                    Enregistrer le brouillon
                  </button>
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={
                      busy || !data.canWrite || !complete || selected.duplicateIds.length > 0
                    }
                    onClick={() => void mutate("VALIDATE")}
                  >
                    Valider l&apos;affectation
                  </button>
                </div>
                {!complete ? (
                  <small>
                    Répartis tout le montant HT pour pouvoir valider. Tu peux enregistrer un
                    brouillon incomplet.
                  </small>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}
