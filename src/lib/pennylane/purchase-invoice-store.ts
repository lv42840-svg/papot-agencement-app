import "server-only";

import type { Pool, PoolClient } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { runServerDbMigrations } from "@/lib/server-db/migrations";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { parsePurchaseOrdersPayload, type PurchaseOrder } from "@/lib/purchases/domain";
import { parseChantiersPayload } from "@/lib/chantiers/domain";
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
    ? value as Record<string, unknown>
    : {};
}
function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
function invoiceSource(row: InvoiceRow, suppliers: Map<string, string>): InvoiceSource {
  const data = obj(row.payload);
  const supplier = obj(data.supplier);
  const supplierId = supplier.id === null || supplier.id === undefined ? null : str(supplier.id);
  const amountHtCents = euroToCents(data.currency_amount_before_tax);
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
      supplierId, amountHtCents, invoiceNumber, invoiceDate, filename,
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
  proposedOrders: Array<{ id: string; reference: string; amountHtCents: number; chantierName: string }>;
};

export type PurchaseInvoiceWorkspaceData = {
  invoices: PurchaseInvoiceListItem[];
  suppliers: Array<{ id: string; name: string }>;
  chantiers: Array<{ id: string; name: string; status: string }>;
  orders: PurchaseOrder[];
  lastImportedAt: string | null;
  truncated: boolean;
  importEnabled: boolean;
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
      pool.query<{ payload: unknown }>("SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'"),
      pool.query<{ payload: unknown }>("SELECT payload FROM papot_chantiers_state WHERE scope = 'global'"),
      pool.query<{ synced_at: Date }>("SELECT synced_at FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'"),
    ]);
  const suppliers = supplierRows.rows.slice(0, 20000).map(row => ({
    id: row.external_id,
    name: str(row.payload.name) || "Fournisseur #" + row.external_id,
  }));
  const bySupplierId = new Map(suppliers.map(row => [row.id, row.name]));
  const states = new Map(allocationRows.rows.map(row => [row.invoice_id, stateOf(row)]));
  const orders = parsePurchaseOrdersPayload(ordersResult.rows[0]?.payload).orders;
  const sites = parseChantiersPayload(sitesResult.rows[0]?.payload).chantiers;
  const sources = invoiceRows.rows.slice(0, 500).map(row => invoiceSource(row, bySupplierId));
  const duplicates = new Map<string, string[]>();
  for (const item of sources) {
    const key = duplicateKey(item);
    if (key) duplicates.set(key, [...(duplicates.get(key) ?? []), item.id]);
  }
  const invoices = sources.map(source => {
    const state = states.get(source.id) ?? null;
    const key = duplicateKey(source);
    return {
      ...source,
      workflow: invoiceWorkflowState(source, state),
      state,
      duplicateIds: key
        ? (duplicates.get(key) ?? []).filter(id => id !== source.id)
        : [],
      proposedOrders: orders
        .filter(order => order.status === "COMMITTED" && (source.supplierId && order.supplierPennylaneId ? order.supplierPennylaneId === source.supplierId : supplierKey(order.supplierName) === supplierKey(source.supplierName)))
        .map(order => ({
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
    chantiers: sites.map(site => ({ id: site.id, name: site.name, status: site.status })),
    lastImportedAt: stateResult.rows[0]?.synced_at.toISOString() ?? null,
    truncated: invoiceRows.rows.length > 500 || supplierRows.rows.length > 20000,
    importEnabled: process.env.PAPOT_PENNYLANE_ENABLED === "true",
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
  const bySupplierId = new Map(suppliers.rows.map(row => [
    row.external_id, str(row.payload.name),
  ]));
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
  return withServerDbTransaction(async client => {
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
      client.query<{ payload: unknown }>("SELECT payload FROM papot_chantiers_state WHERE scope = 'global'"),
      client.query<{ payload: unknown }>("SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'"),
    ]);
    const sites = new Set(parseChantiersPayload(siteResult.rows[0]?.payload).chantiers.map(item => item.id));
    for (const row of draft.rows) {
      if (row.destination.kind === "CHANTIER" && !sites.has(row.destination.chantierId!)) {
        throw new Error("INVOICE_CHANTIER_NOT_FOUND");
      }
    }
    const orders = new Map(parsePurchaseOrdersPayload(orderResult.rows[0]?.payload).orders.map(item => [item.id, item]));
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
      [invoiceId, nextVersion, JSON.stringify(draft), approved ? JSON.stringify(approved) : null, JSON.stringify(history)],
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

export async function readValidatedPurchaseCosts(pool: Pool = getServerDbPool()): Promise<{
  imported: boolean;
  byChantier: Record<string, number>;
  provisionalByChantier: Record<string, boolean>;
}> {
  await runServerDbMigrations(pool);
  const imported = await pool.query("SELECT 1 FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'");
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
    const provisional = source.sourceRevision !== row.approved.sourceRevision ||
      Boolean((row as typeof row & { draft: InvoiceAllocationDraft | null }).draft &&
        JSON.stringify((row as typeof row & { draft: InvoiceAllocationDraft | null }).draft) !== JSON.stringify(row.approved.draft));
    for (const allocation of calc.destinations) {
      if (allocation.destination.kind !== "CHANTIER") continue;
      const id = allocation.destination.chantierId!;
      byChantier[id] = (byChantier[id] ?? 0) + allocation.totalHtCents;
      provisionalByChantier[id] = provisionalByChantier[id] || provisional;
    }
  }
  return { imported: true, byChantier, provisionalByChantier };
}
