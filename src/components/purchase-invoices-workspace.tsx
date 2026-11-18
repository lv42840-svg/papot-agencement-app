"use client";

import Link from "next/link";
import { CalculatedAmountInput } from "@/components/calculated-amount-input";
import { useEffect, useMemo, useState } from "react";
import { purchaseOrderAllocations, type PurchaseOrder } from "@/lib/purchases/domain";
import {
  calculateInvoiceAllocation,
  distributeCharge,
  destinationKey,
  invoiceNeedsPapotValidation,
  type InvoiceAllocationDraft,
  type InvoiceDestination,
} from "@/lib/pennylane/purchase-allocations";
import type { PurchaseInvoiceWorkspaceData } from "@/lib/pennylane/purchase-invoice-store";

type ResponseBody = PurchaseInvoiceWorkspaceData & { canWrite: boolean; error?: string };
type FgAssignmentResult = {
  assigned: number;
  supplierCount: number;
  matchingSupplierInvoices: number;
  skippedExisting: number;
  skippedChantierOrder: number;
  skippedDuplicate: number;
  skippedInvalid: number;
};
function fgAssignmentSummary(result: FgAssignmentResult): string {
  return (
    `${result.assigned} facture(s) validée(s) en frais généraux dans PAPOT sur ${result.matchingSupplierInvoices} facture(s) de ${result.supplierCount} fournisseur(s) FG. ` +
    `${result.skippedExisting} déjà affectée(s), ${result.skippedChantierOrder} rapprochement(s) BC chantier/SAV à vérifier, ${result.skippedDuplicate} doublon(s), ${result.skippedInvalid} autre(s) anomalie(s). ` +
    "Les factures non validées dans Pennylane restent provisoires."
  );
}

const money = (value: number | null) =>
  value === null
    ? "Indisponible"
    : (value / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
function asGlobalDraft(value: InvoiceAllocationDraft): InvoiceAllocationDraft {
  if (value.mode === "GLOBAL") return value;
  return {
    ...value,
    mode: "GLOBAL",
    rows: value.rows.map((row) => ({ ...row, sourceLineId: null })),
  };
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
    PENNYLANE_SYNC_IN_PROGRESS:
      "Une actualisation Pennylane est déjà en cours. Réessaie après sa fin.",
  };
  return text[code] ?? "Opération impossible (" + code + ").";
}

export function PurchaseInvoicesWorkspace({
  initialTab = "ALL",
}: {
  initialTab?: "ALL" | "PENDING" | "APPROVED";
}) {
  const [data, setData] = useState<ResponseBody | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [invoiceTab, setInvoiceTab] = useState<"ALL" | "PENDING" | "APPROVED">(initialTab);
  const [draft, setDraft] = useState<InvoiceAllocationDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFrom, setOrderFrom] = useState("");
  const [orderTo, setOrderTo] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/desktop/purchase-invoices", { cache: "no-store" });
    const body = (await response.json()) as ResponseBody;
    if (!response.ok) throw new Error(body.error ?? "INVOICE_LOAD_FAILED");
    setData(body);
    setSelectedId((id) => {
      const current =
        invoiceTab === "APPROVED"
          ? body.validatedInvoices
          : invoiceTab === "PENDING"
            ? body.invoices.filter((invoice) => invoiceNeedsPapotValidation(invoice.workflow))
            : body.invoices;
      return current.some((item) => item.id === id) ? id : (current[0]?.id ?? "");
    });
  }
  useEffect(() => {
    void load().catch(() => setError("Impossible de charger les factures fournisseurs."));
  }, []);

  const currentTabInvoices =
    invoiceTab === "APPROVED" ? (data?.validatedInvoices ?? []) : (data?.invoices ?? []);
  const visibleInvoices = currentTabInvoices.filter(
    (invoice) =>
      (invoiceTab === "ALL" ||
        (invoiceTab === "PENDING"
          ? invoiceNeedsPapotValidation(invoice.workflow)
          : Boolean(invoice.state?.approved))) &&
      [invoice.supplierName, invoice.invoiceNumber, invoice.invoiceDate ?? ""]
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(search.toLocaleLowerCase("fr-FR")),
  );
  const selected =
    visibleInvoices.find((item) => item.id === selectedId) ?? visibleInvoices[0] ?? null;
  const canEditSelected = Boolean(data?.canWrite && selected?.availableInPennylane);

  useEffect(() => {
    const current = selected?.state?.draft ?? selected?.state?.approved?.draft ?? emptyDraft();
    setDraft(asGlobalDraft(current));
  }, [selected?.id, selected?.state?.version]);

  const visibleProposedOrders = (selected?.proposedOrders ?? []).filter((order) => {
    const text = [order.reference, order.chantierName, order.clientName]
      .join(" ")
      .toLocaleLowerCase("fr-FR");
    const date = order.createdAt.slice(0, 10);
    return (
      text.includes(orderSearch.trim().toLocaleLowerCase("fr-FR")) &&
      (!orderFrom || date >= orderFrom) &&
      (!orderTo || date <= orderTo)
    );
  });

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
    calculation.totalHtCents === selected?.amountHtCents;

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
  async function mutate(action: "SAVE" | "VALIDATE" | "REFRESH" | "AUTO_ASSIGN_FG") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        action === "REFRESH" || action === "AUTO_ASSIGN_FG"
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
      const result = (await response.json()) as {
        error?: string;
        result?: FgAssignmentResult;
        refreshed?: { generalExpenses: FgAssignmentResult };
      };
      if (!response.ok) throw new Error(result.error ?? "INVOICE_SAVE_FAILED");
      await load();
      setNotice(
        action === "REFRESH" || action === "AUTO_ASSIGN_FG"
          ? (action === "REFRESH" ? "Pennylane actualisé. " : "Rattrapage FG terminé. ") +
              (result.result || result.refreshed?.generalExpenses
                ? fgAssignmentSummary(result.result ?? result.refreshed!.generalExpenses)
                : "Aucune affectation automatique à signaler.")
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
          <button
            type="button"
            className="primaryButton"
            disabled={busy || !data?.canWrite || !data?.importEnabled || !data?.fgSupplierCount}
            title="Rattraper les factures des fournisseurs FG et valider leur affectation dans PAPOT"
            onClick={() => {
              if (
                window.confirm(
                  "Actualiser Pennylane et valider dans PAPOT les factures non affectées des fournisseurs FG ? " +
                    "Les factures avec BC chantier/SAV possible et les affectations existantes ne seront pas modifiées.",
                )
              ) {
                void mutate("AUTO_ASSIGN_FG");
              }
            }}
          >
            Affecter les factures FG
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
      {data?.canWrite && data?.importEnabled && data.fgSupplierCount === 0 ? (
        <small>
          Aucun fournisseur programmé FG. Configure-les dans Bons de commande → Fournisseurs · Frais
          généraux.
        </small>
      ) : null}
      <p style={{ fontSize: 13, color: "#615976" }}>
        Dernier import :{" "}
        {data?.lastImportedAt ? new Date(data.lastImportedAt).toLocaleString("fr-FR") : "Aucun"}.
        {!data?.importEnabled
          ? " Synchronisation désactivée : activation serveur nécessaire après tests de la clé."
          : ""}
        {data?.truncated && invoiceTab !== "APPROVED"
          ? " Affichage des 500 dernières factures (les coûts validés restent conservés)."
          : ""}
        {data?.validatedTruncated && invoiceTab === "APPROVED"
          ? " Affichage limité aux 500 affectations validées les plus récentes."
          : ""}
      </p>
      {data && (data.invoices.length > 0 || data.validatedInvoices.length > 0) ? (
        <div
          role="tablist"
          aria-label="Vue des factures fournisseurs"
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={invoiceTab === "ALL"}
            className={invoiceTab === "ALL" ? "primaryButton" : "secondaryButton"}
            onClick={() => {
              setInvoiceTab("ALL");
              setSelectedId("");
            }}
          >
            Toutes les factures ({data.invoices.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={invoiceTab === "PENDING"}
            className={invoiceTab === "PENDING" ? "primaryButton" : "secondaryButton"}
            onClick={() => {
              setInvoiceTab("PENDING");
              setSelectedId("");
            }}
          >
            Factures à valider (
            {
              data.invoices.filter((invoice) => invoiceNeedsPapotValidation(invoice.workflow))
                .length
            }
            )
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={invoiceTab === "APPROVED"}
            className={invoiceTab === "APPROVED" ? "primaryButton" : "secondaryButton"}
            onClick={() => {
              setInvoiceTab("APPROVED");
              setSelectedId("");
            }}
          >
            Factures validées ({data.validatedInvoices.length})
          </button>
        </div>
      ) : null}
      {!data ? (
        <p>Chargement…</p>
      ) : data.invoices.length === 0 && data.validatedInvoices.length === 0 ? (
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
            <h2>
              {invoiceTab === "ALL"
                ? "Toutes les factures"
                : invoiceTab === "PENDING"
                  ? "Factures à valider"
                  : "Factures validées"}{" "}
              ({visibleInvoices.length})
            </h2>
            <input
              aria-label="Rechercher une facture"
              placeholder="Fournisseur, numéro, date…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {visibleInvoices.length === 0 ? (
              <p style={{ fontSize: 13 }}>Aucune facture dans cette vue.</p>
            ) : null}
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
                    background: selected?.id === invoice.id ? "#eee8fb" : "#faf9fd",
                    border: selected?.id === invoice.id ? "1px solid #a999e4" : "1px solid #e6e0ef",
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
                    {!invoice.availableInPennylane ? " · Historique PAPOT" : ""}
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
                {!selected.availableInPennylane ? (
                  <p role="status" style={{ color: "#8a5d26" }}>
                    Facture historisée dans PAPOT, absente du dernier import Pennylane. Son coût est
                    conservé dans le suivi du chantier comme provisoire. Cette affectation est en
                    lecture seule.
                  </p>
                ) : null}
                {selected.duplicateIds.length ? (
                  <p style={{ color: "#a43a26" }}>
                    Doublon potentiel avec la facture {selected.duplicateIds.join(", ")}. La
                    validation est bloquée jusqu&apos;à résolution.
                  </p>
                ) : null}
                {selected.hasPdf && selected.availableInPennylane ? (
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
            <h2>Affectation PAPOT</h2>
            {selected ? (
              <>
                <p style={{ fontSize: 13 }}>
                  Répartition globale HT, par chantier, SAV ou frais généraux.
                </p>
                <h3>Bons de commande proposés ({visibleProposedOrders.length})</h3>
                <input
                  aria-label="Filtrer les bons de commande par client ou chantier"
                  placeholder="Rechercher BC, client ou chantier…"
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <label>
                    Date BC du
                    <input
                      type="date"
                      value={orderFrom}
                      onChange={(event) => setOrderFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    Au
                    <input
                      type="date"
                      value={orderTo}
                      onChange={(event) => setOrderTo(event.target.value)}
                    />
                  </label>
                </div>
                {selected.proposedOrders.length === 0 ? (
                  <p>Aucun BC correspondant à ce fournisseur. Affectation manuelle possible.</p>
                ) : visibleProposedOrders.length === 0 ? (
                  <p>Aucun BC pour ces critères. Modifie les filtres.</p>
                ) : null}
                {visibleProposedOrders.map((proposal) => {
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
                      <small>
                        BC du {new Date(proposal.createdAt).toLocaleDateString("fr-FR")}
                        {proposal.clientName ? " · Client : " + proposal.clientName : ""}
                      </small>
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
                            <CalculatedAmountInput
                              label="Part rapprochée HT (€)"
                              valueCents={link.appliedHtCents}
                              disabled={busy || !canEditSelected}
                              onCommit={(amountCents) =>
                                setDraft((current) => ({
                                  ...current,
                                  orderLinks: current.orderLinks.map((item) =>
                                    item.orderId === proposal.id
                                      ? { ...item, appliedHtCents: amountCents }
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
                              disabled={busy || !canEditSelected}
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
                            !canEditSelected ||
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
                    <label>
                      Destination
                      <select
                        value={
                          row.destination.kind === "CHANTIER"
                            ? (row.destination.chantierId ?? "")
                            : row.destination.kind
                        }
                        disabled={busy || !canEditSelected}
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
                      <CalculatedAmountInput
                        label="Montant achats HT (€)"
                        valueCents={row.amountHtCents}
                        allowNegative
                        disabled={busy || !canEditSelected}
                        onCommit={(amountCents) => editRow(row.id, { amountHtCents: amountCents })}
                      />
                    </label>
                    {draft.rows.length === 1 &&
                    row.destination.kind === "CHANTIER" &&
                    selected.amountHtCents !== null ? (
                      <button
                        type="button"
                        className="secondaryButton"
                        disabled={busy || !canEditSelected}
                        onClick={() => {
                          const chargesHtCents = draft.charges.reduce(
                            (sum, charge) => sum + charge.amountHtCents,
                            0,
                          );
                          const amountHtCents = selected.amountHtCents! - chargesHtCents;
                          if (amountHtCents < 0) {
                            setError("Les frais annexes dépassent le total HT de la facture.");
                            return;
                          }
                          editRow(row.id, { amountHtCents });
                        }}
                      >
                        Reprendre le total HT de la facture
                      </button>
                    ) : null}
                    <button
                      className="secondaryButton"
                      type="button"
                      disabled={busy || !canEditSelected}
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
                  disabled={busy || !canEditSelected}
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
                        disabled={busy || !canEditSelected}
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
                      <CalculatedAmountInput
                        label="Montant HT des frais ou remises (€)"
                        valueCents={charge.amountHtCents}
                        allowNegative
                        disabled={busy || !canEditSelected}
                        onCommit={(amountCents) =>
                          setDraft((current) => ({
                            ...current,
                            charges: current.charges.map((item) =>
                              item.id === charge.id
                                ? { ...item, amountHtCents: amountCents }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Répartir au prorata sur
                      <select
                        disabled={busy || !canEditSelected}
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
                      disabled={busy || !canEditSelected}
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
                  disabled={busy || !canEditSelected}
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
                    disabled={busy || !canEditSelected}
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
                    disabled={busy || !canEditSelected}
                    onClick={() => void mutate("SAVE")}
                  >
                    Enregistrer le brouillon
                  </button>
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={
                      busy || !canEditSelected || !complete || selected.duplicateIds.length > 0
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
