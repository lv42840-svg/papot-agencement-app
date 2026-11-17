import "server-only";

import type { Pool, PoolClient } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { runServerDbMigrations } from "@/lib/server-db/migrations";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { parsePurchaseOrdersPayload, purchaseOrderAllocations, type PurchaseOrder } from "@/lib/purchases/domain";
import { parseChantiersPayload } from "@/lib/chantiers/domain";
import { planGeneralExpensesAllocations } from "./general-expenses-auto-allocation";
import {
  assertInvoiceComplete,
  calculateInvoiceAllocation,
  euroToCents,
  invoiceWorkflowState,
  sourceRevision,
  supplierKey,
  type InvoiceAllocationDraft,
  invoiceAllocationDraftSchema,
  type InvoiceAllocationState,
  type InvoiceSource,
  type ApprovedInvoiceAllocation,
} from "./purchase-allocations";

type InvoiceRow = { external_id: string; payload: Record<string, unknown> };
type AllocationRow = {
  invoice_id: string;
  version: number;
  draft: InvoiceAllocationDraft | null;
  approved: ApprovedInvoiceAllocation | null;
  history: InvoiceAllocationState["history"];
  updated_at: Date;
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
function invoiceSource(row: InvoiceRow, suppliers: Map<string, string>): InvoiceSource {
  const data = obj(row.payload);
  const supplier = obj(data.supplier);
  const supplierId = supplier.id === null || supplier.id === undefined ? null : str(supplier.id);
  // Foreign currencies must not be misrepresented as EUR costs.
  const amountHtCents =
    data.currency === "EUR" ? euroToCents(data.currency_amount_before_tax) : null;
  const invoiceNumber = str(data.invoice_number);
  const invoiceDate = str(data.date) || null;
  const filename = str(data.filename) || null;
  return {
    id: row.external_id,
    supplierId,
    supplierName: (supplierId && suppliers.get(supplierId)) || "Fournisseur non identifié",
    invoiceNumber,
    invoiceDate,
    amountHtCents,
    accountingStatus: str(data.accounting_status),
    hasPdf: Boolean(data.public_file_url || filename),
    sourceRevision: sourceRevision({
      supplierId,
      amountHtCents,
      invoiceNumber,
      invoiceDate,
      filename,
    }),
  };
}

function stateOf(row: AllocationRow | undefined): InvoiceAllocationState | null {
  return row
    ? {
        invoiceId: row.invoice_id,
        version: row.version,
        draft: row.draft,
        approved: row.approved,
        history: row.history,
        updatedAt: row.updated_at.toISOString(),
      }
    : null;
}

function duplicateKey(source: InvoiceSource): string | null {
  return source.supplierId && source.invoiceNumber.trim() && source.amountHtCents !== null
    ? [source.supplierId, supplierKey(source.invoiceNumber), source.amountHtCents].join(":")
    : null;
}

export type PurchaseInvoiceListItem = InvoiceSource & {
  workflow: ReturnType<typeof invoiceWorkflowState>;
  state: InvoiceAllocationState | null;
  duplicateIds: string[];
  proposedOrders: Array<{
    id: string;
    reference: string;
    amountHtCents: number;
    chantierName: string;
  }>;
};

export type PurchaseInvoiceWorkspaceData = {
  invoices: PurchaseInvoiceListItem[];
  suppliers: Array<{ id: string; name: string }>;
  chantiers: Array<{ id: string; name: string; status: string }>;
  orders: PurchaseOrder[];
  orderBalances: Record<
    string,
    { billedHtCents: number; remainingHtCents: number; settled: boolean; invoiceCount: number }
  >;
  lastImportedAt: string | null;
  truncated: boolean;
  importEnabled: boolean;
  fgSupplierCount: number;
};

export async function readPurchaseInvoiceWorkspace(
  pool: Pool = getServerDbPool(),
): Promise<PurchaseInvoiceWorkspaceData> {
  await runServerDbMigrations(pool);
  const [invoiceRows, supplierRows, allocationRows, ordersResult, sitesResult, stateResult] =
    await Promise.all([
      pool.query<InvoiceRow>(
        "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'supplier_invoices' ORDER BY external_id DESC LIMIT 501",
      ),
      pool.query<InvoiceRow>(
        "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'suppliers' ORDER BY external_id LIMIT 20001",
      ),
      pool.query<AllocationRow>("SELECT * FROM papot_pennylane_purchase_allocations"),
      pool.query<{ payload: unknown }>(
        "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'",
      ),
      pool.query<{ payload: unknown }>(
        "SELECT payload FROM papot_chantiers_state WHERE scope = 'global'",
      ),
      pool.query<{ synced_at: Date }>(
        "SELECT synced_at FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'",
      ),
    ]);
  const suppliers = supplierRows.rows.slice(0, 20000).map((row) => ({
    id: row.external_id,
    name: str(row.payload.name) || "Fournisseur #" + row.external_id,
  }));
  const bySupplierId = new Map(suppliers.map((row) => [row.id, row.name]));
  const states = new Map(allocationRows.rows.map((row) => [row.invoice_id, stateOf(row)]));
  const purchases = parsePurchaseOrdersPayload(ordersResult.rows[0]?.payload);
  const orders = purchases.orders;
  const sites = parseChantiersPayload(sitesResult.rows[0]?.payload).chantiers;
  const sources = invoiceRows.rows.slice(0, 500).map((row) => invoiceSource(row, bySupplierId));
  const duplicates = new Map<string, string[]>();
  for (const item of sources) {
    const key = duplicateKey(item);
    if (key) duplicates.set(key, [...(duplicates.get(key) ?? []), item.id]);
  }
  const usage = new Map<
    string,
    { billedHtCents: number; settled: boolean; invoiceCount: number }
  >();
  for (const state of states.values()) {
    for (const link of state?.approved?.draft.orderLinks ?? []) {
      const row = usage.get(link.orderId) ?? { billedHtCents: 0, settled: false, invoiceCount: 0 };
      row.billedHtCents += link.appliedHtCents;
      row.settled ||= link.settle;
      row.invoiceCount += 1;
      usage.set(link.orderId, row);
    }
  }
  const orderBalances = Object.fromEntries(
    orders.map((order) => {
      const used = usage.get(order.id) ?? { billedHtCents: 0, settled: false, invoiceCount: 0 };
      return [
        order.id,
        {
          ...used,
          remainingHtCents: used.settled
            ? 0
            : Math.max(0, order.amountHtCents - used.billedHtCents),
        },
      ];
    }),
  );

  const invoices = sources.map((source) => {
    const state = states.get(source.id) ?? null;
    const key = duplicateKey(source);
    return {
      ...source,
      workflow: invoiceWorkflowState(source, state),
      state,
      duplicateIds: key ? (duplicates.get(key) ?? []).filter((id) => id !== source.id) : [],
      proposedOrders: orders
        .filter(
          (order) =>
            order.status === "COMMITTED" &&
            (source.supplierId && order.supplierPennylaneId
              ? order.supplierPennylaneId === source.supplierId
              : supplierKey(order.supplierName) === supplierKey(source.supplierName)),
        )
        .map((order) => ({
          id: order.id,
          reference: order.reference,
          amountHtCents: order.amountHtCents,
          chantierName: order.chantierName,
        })),
    };
  });
  return {
    invoices,
    suppliers,
    orders,
    orderBalances,
    chantiers: sites.map((site) => ({ id: site.id, name: site.name, status: site.status })),
    lastImportedAt: stateResult.rows[0]?.synced_at.toISOString() ?? null,
    truncated: invoiceRows.rows.length > 500 || supplierRows.rows.length > 20000,
    importEnabled: process.env.PAPOT_PENNYLANE_ENABLED === "true",
    fgSupplierCount: purchases.supplierPreferences?.length ?? 0,
  };
}

async function loadInvoiceForUpdate(client: PoolClient, invoiceId: string) {
  const response = await client.query<InvoiceRow>(
    "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'supplier_invoices' AND external_id = $1",
    [invoiceId],
  );
  if (!response.rows[0]) throw new Error("INVOICE_NOT_IMPORTED");
  const suppliers = await client.query<InvoiceRow>(
    "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'suppliers'",
  );
  const bySupplierId = new Map(
    suppliers.rows.map((row) => [row.external_id, str(row.payload.name)]),
  );
  return invoiceSource(response.rows[0], bySupplierId);
}

export async function writePurchaseInvoiceAllocation(
  action: "SAVE" | "VALIDATE",
  invoiceId: string,
  expectedVersion: number,
  expectedRevision: string,
  submitted: InvoiceAllocationDraft,
  actor: string,
  pool: Pool = getServerDbPool(),
): Promise<InvoiceAllocationState> {
  await runServerDbMigrations(pool);
  const draft = invoiceAllocationDraftSchema.parse(submitted);
  return withServerDbTransaction(async (client) => {
    // The same lock is used by the staging publisher and credential removal.
    await client.query("SELECT pg_advisory_xact_lock($1)", ["7332170416238558"]);
    const source = await loadInvoiceForUpdate(client, invoiceId);
    if (source.sourceRevision !== expectedRevision) throw new Error("INVOICE_SOURCE_CHANGED");
    const stored = await client.query<AllocationRow>(
      "SELECT * FROM papot_pennylane_purchase_allocations WHERE invoice_id = $1 FOR UPDATE",
      [invoiceId],
    );
    const previous = stored.rows[0];
    if ((previous?.version ?? 0) !== expectedVersion) throw new Error("INVOICE_VERSION_CONFLICT");
    const [siteResult, orderResult] = await Promise.all([
      client.query<{ payload: unknown }>(
        "SELECT payload FROM papot_chantiers_state WHERE scope = 'global'",
      ),
      client.query<{ payload: unknown }>(
        "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'",
      ),
    ]);
    const sites = new Set(
      parseChantiersPayload(siteResult.rows[0]?.payload).chantiers.map((item) => item.id),
    );
    for (const row of draft.rows) {
      if (row.destination.kind === "CHANTIER" && !sites.has(row.destination.chantierId!)) {
        throw new Error("INVOICE_CHANTIER_NOT_FOUND");
      }
    }
    const orders = new Map(
      parsePurchaseOrdersPayload(orderResult.rows[0]?.payload).orders.map((item) => [
        item.id,
        item,
      ]),
    );
    for (const link of draft.orderLinks) {
      const order = orders.get(link.orderId);
      if (!order || order.status !== "COMMITTED") throw new Error("INVOICE_ORDER_NOT_FOUND");
    }
    let approved = previous?.approved ?? null;
    if (action === "VALIDATE") {
      if (source.amountHtCents === null) throw new Error("INVOICE_AMOUNT_INVALID");
      assertInvoiceComplete(draft, source.amountHtCents);
      if (source.supplierId && source.invoiceNumber.trim()) {
        const siblings = await client.query<InvoiceRow>(
          "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'supplier_invoices' AND external_id <> $1",
          [invoiceId],
        );
        for (const row of siblings.rows) {
          const other = invoiceSource(row, new Map());
          if (duplicateKey(other) === duplicateKey(source)) {
            throw new Error("INVOICE_POSSIBLE_DUPLICATE");
          }
        }
      }
      approved = {
        draft,
        amountHtCents: source.amountHtCents,
        sourceRevision: source.sourceRevision,
        validatedAt: new Date().toISOString(),
        validatedBy: actor,
      };
    }
    const now = new Date().toISOString();
    const nextVersion = expectedVersion + 1;
    const history = [
      ...(previous?.history ?? []),
      {
        at: now,
        actor,
        action,
        version: nextVersion,
        // The full prior state is retained for audit, never overwritten.
        previousDraft: previous?.draft ?? null,
        previousApproved: previous?.approved ?? null,
        newDraft: draft,
        newApproved: approved,
      },
    ];
    await client.query(
      "INSERT INTO papot_pennylane_purchase_allocations (invoice_id, version, draft, approved, history, updated_at) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW()) ON CONFLICT (invoice_id) DO UPDATE SET version = EXCLUDED.version, draft = EXCLUDED.draft, approved = EXCLUDED.approved, history = EXCLUDED.history, updated_at = NOW()",
      [
        invoiceId,
        nextVersion,
        JSON.stringify(draft),
        approved ? JSON.stringify(approved) : null,
        JSON.stringify(history),
      ],
    );
    return {
      invoiceId,
      version: nextVersion,
      draft,
      approved,
      history,
      updatedAt: now,
    };
  }, pool);
}

export type GeneralExpensesAutoAllocationResult = {
  supplierCount: number;
  matchingSupplierInvoices: number;
  assigned: number;
  skippedExisting: number;
  skippedChantierOrder: number;
  skippedDuplicate: number;
  skippedInvalid: number;
};

/** Identifiant Pennylane prioritaire ; vieux BC sans ID : nom fournisseur exact normalisé. */
function purchaseOrderMayBelongToInvoiceSupplier(
  source: InvoiceSource,
  order: PurchaseOrder,
): boolean {
  if (order.supplierPennylaneId) {
    return order.supplierPennylaneId === source.supplierId;
  }
  return (
    source.supplierName !== "Fournisseur non identifié" &&
    supplierKey(order.supplierName) === supplierKey(source.supplierName)
  );
}

/**
 * Valide immédiatement dans PAPOT les factures sûres des fournisseurs FG.
 * La validation comptable Pennylane est indépendante : une facture non comptabilisée
 * restera AWAITING_PENNYLANE et ne deviendra pas un coût réel.
 * 
 * Ne modifie jamais une ligne d'affectation existante. Si un BC engagé du même
 * fournisseur comporte un chantier (ou le SAV), le rapprochement est incertain :
 * la facture reste sans affectation automatique, à examiner manuellement.
 */
export async function autoAllocateImportedGeneralExpensesInvoices(
  actor: string,
  pool: Pool = getServerDbPool(),
): Promise<GeneralExpensesAutoAllocationResult> {
  await runServerDbMigrations(pool);
  return withServerDbTransaction(async (client) => {
    // Verrou commun avec synchro staging et modifications manuelles.
    await client.query("SELECT pg_advisory_xact_lock($1)", ["7332170416238558"]);
    const imported = await client.query(
      "SELECT 1 FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'",
    );
    if (!imported.rows[0]) throw new Error("INVOICE_NOT_IMPORTED");

    const preferences = await client.query<{ payload: unknown }>(
      "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global' FOR SHARE",
    );
    const purchaseState = parsePurchaseOrdersPayload(preferences.rows[0]?.payload);
    const configured = new Set(
      (purchaseState.supplierPreferences ?? [])
        .filter((row) => row.defaultDestination === "GENERAL_EXPENSES")
        .map((row) => row.supplierPennylaneId),
    );
    const empty: GeneralExpensesAutoAllocationResult = {
      supplierCount: configured.size,
      matchingSupplierInvoices: 0,
      assigned: 0,
      skippedExisting: 0,
      skippedChantierOrder: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
    };
    // A sync without configured suppliers must continue normally.
    if (!configured.size) return empty;

    const supplierRows = await client.query<InvoiceRow>(
      "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'suppliers'",
    );
    const supplierNames = new Map(
      supplierRows.rows.map((row) => [
        row.external_id,
        str(row.payload.name) || "Fournisseur #" + row.external_id,
      ]),
    );
    const result = await client.query<InvoiceRow & { stored_invoice_id: string | null }>(
      "SELECT s.external_id, s.payload, a.invoice_id AS stored_invoice_id FROM papot_pennylane_staging s LEFT JOIN papot_pennylane_purchase_allocations a ON a.invoice_id = s.external_id WHERE s.resource = 'supplier_invoices' ORDER BY s.external_id",
    );
    const relevantOrders = purchaseState.orders.filter(
      (order) =>
        order.status === "COMMITTED" &&
        purchaseOrderAllocations(order).some(
          (destination) => (destination.destinationType ?? "CHANTIER") !== "GENERAL_EXPENSES",
        ),
    );
    const plan = planGeneralExpensesAllocations(
      result.rows.map((row) => {
        const source = invoiceSource(row, supplierNames);
        return {
          source,
          alreadyAllocated: row.stored_invoice_id !== null,
          possibleChantierOrder: relevantOrders.some((order) =>
            purchaseOrderMayBelongToInvoiceSupplier(source, order),
          ),
        };
      }),
      configured,
    );
    let assigned = 0;
    const now = new Date().toISOString();
    // Une opération atomique, validations tracées, clics répétés idempotents.
    for (let index = 0; index < plan.candidates.length; index += 200) {
      const records = plan.candidates.slice(index, index + 200).map((item) => {
        assertInvoiceComplete(item.draft, item.amountHtCents);
        const approved: ApprovedInvoiceAllocation = {
          draft: item.draft,
          amountHtCents: item.amountHtCents,
          sourceRevision: item.sourceRevision,
          validatedAt: now,
          validatedBy: actor,
        };
        return {
          invoice_id: item.invoiceId,
          draft: item.draft,
          approved,
          history: [{
            at: now,
            actor,
            action: "VALIDATE",
            version: 1,
            previousDraft: null,
            previousApproved: null,
            newDraft: item.draft,
            newApproved: approved,
          }],
        };
      });
      const written = await client.query<{ invoice_id: string }>(
        "INSERT INTO papot_pennylane_purchase_allocations (invoice_id, version, draft, approved, history, updated_at) SELECT x.invoice_id, 1, x.draft, x.approved, x.history, NOW() FROM jsonb_to_recordset($1::jsonb) AS x(invoice_id TEXT, draft JSONB, approved JSONB, history JSONB) ON CONFLICT (invoice_id) DO NOTHING RETURNING invoice_id",
        [JSON.stringify(records)],
      );
      assigned += written.rowCount ?? 0;
    }
    return {
      supplierCount: configured.size,
      matchingSupplierInvoices: plan.matchingSupplierInvoices,
      assigned,
      skippedExisting: plan.skippedExisting + (plan.candidates.length - assigned),
      skippedChantierOrder: plan.skippedChantierOrder,
      skippedDuplicate: plan.skippedDuplicate,
      skippedInvalid: plan.skippedInvalid,
    };
  }, pool);
}

export async function readValidatedPurchaseCosts(pool: Pool = getServerDbPool()): Promise<{
  imported: boolean;
  byChantier: Record<string, number>;
  provisionalByChantier: Record<string, boolean>;
}> {
  await runServerDbMigrations(pool);
  const imported = await pool.query(
    "SELECT 1 FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'",
  );
  if (!imported.rows[0]) return { imported: false, byChantier: {}, provisionalByChantier: {} };
  const result = await pool.query<InvoiceRow & { approved: ApprovedInvoiceAllocation | null }>(
    "SELECT s.external_id, s.payload, a.approved, a.draft FROM papot_pennylane_staging s LEFT JOIN papot_pennylane_purchase_allocations a ON a.invoice_id = s.external_id WHERE s.resource = 'supplier_invoices'",
  );
  const byChantier: Record<string, number> = {};
  const provisionalByChantier: Record<string, boolean> = {};
  for (const row of result.rows) {
    if (!row.approved) continue;
    const source = invoiceSource(row, new Map());
    // This only counts amounts once they have both approvals.
    if (source.accountingStatus !== "complete") continue;
    const calc = calculateInvoiceAllocation(row.approved.draft);
    const provisional =
      source.sourceRevision !== row.approved.sourceRevision ||
      Boolean(
        (row as typeof row & { draft: InvoiceAllocationDraft | null }).draft &&
          JSON.stringify((row as typeof row & { draft: InvoiceAllocationDraft | null }).draft) !==
            JSON.stringify(row.approved.draft),
      );
    for (const allocation of calc.destinations) {
      if (allocation.destination.kind !== "CHANTIER") continue;
      const id = allocation.destination.chantierId!;
      byChantier[id] = (byChantier[id] ?? 0) + allocation.totalHtCents;
      provisionalByChantier[id] = provisionalByChantier[id] || provisional;
    }
  }
  return { imported: true, byChantier, provisionalByChantier };
}
