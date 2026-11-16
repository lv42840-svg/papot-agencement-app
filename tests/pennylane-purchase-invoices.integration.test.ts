import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import {
  readPurchaseInvoiceWorkspace,
  readValidatedPurchaseCosts,
  writePurchaseInvoiceAllocation,
} from "../src/lib/pennylane/purchase-invoice-store";
import type { InvoiceAllocationDraft } from "../src/lib/pennylane/purchase-allocations";

const describeIfPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;
const id = "987654321012";
const otherId = "987654321013";
const supplier = "987654321014";
const basePayload = {
  id: Number(id),
  supplier: { id: Number(supplier) },
  invoice_number: "TEST-BC-2026-11-16",
  date: "2026-11-16",
  currency: "EUR",
  currency_amount_before_tax: "100.00",
  filename: "test.pdf",
  accounting_status: "complete",
};

function draft(): InvoiceAllocationDraft {
  return {
    mode: "GLOBAL",
    rows: [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceLineId: null,
      destination: { kind: "GENERAL_EXPENSES", chantierId: null },
      amountHtCents: 10000,
    }],
    charges: [],
    orderLinks: [],
    note: "",
  };
}

describeIfPostgres("Pennylane purchase invoice workflow in isolated PostgreSQL", () => {
  let pool: Pool;
  let revision = "";

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
    await pool.query(
      "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) VALUES ('suppliers',$1,$2::jsonb,NOW()),('supplier_invoices',$3,$4::jsonb,NOW()) ON CONFLICT (resource, external_id) DO UPDATE SET payload=EXCLUDED.payload, synced_at=NOW()",
      [supplier, JSON.stringify({ id: Number(supplier), name: "Fournisseur de test" }), id, JSON.stringify(basePayload)],
    );
    await pool.query(
      "INSERT INTO papot_pennylane_sync_state (resource, company_name, synced_at, item_count) VALUES ('supplier_invoices','PAPOT LIBERAL',NOW(),1) ON CONFLICT (resource) DO UPDATE SET synced_at=NOW(), item_count=1",
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM papot_pennylane_purchase_allocations WHERE invoice_id IN ($1, $2)", [id, otherId]);
    await pool.query("DELETE FROM papot_pennylane_staging WHERE external_id IN ($1, $2, $3)", [id, otherId, supplier]);
    await pool.query("DELETE FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'");
    await closeServerDbPool();
  });

  it("reads a real V2 EUR amount and stores a draft without real costs", async () => {
    const data = await readPurchaseInvoiceWorkspace(pool);
    const invoice = data.invoices.find(item => item.id === id)!;
    expect(invoice).toBeTruthy();
    expect(invoice.amountHtCents).toBe(10000);
    expect(invoice.supplierName).toBe("Fournisseur de test");
    revision = invoice.sourceRevision;
    const incomplete = { ...draft(), rows: [] };
    const result = await writePurchaseInvoiceAllocation("SAVE", id, 0, revision, incomplete, "Nadia", pool);
    expect(result.version).toBe(1);
    expect(result.approved).toBeNull();
    const costs = await readValidatedPurchaseCosts(pool);
    expect(costs.imported).toBe(true);
    expect(costs.byChantier).toEqual({});
  });

  it("refuses an incomplete validation and protects against outdated versions", async () => {
    await expect(writePurchaseInvoiceAllocation("VALIDATE", id, 1, revision, {
      ...draft(), rows: [],
    }, "Nadia", pool)).rejects.toThrow("INVOICE_ALLOCATION_INCOMPLETE");
    await expect(writePurchaseInvoiceAllocation("SAVE", id, 0, revision, draft(), "Nadia", pool))
      .rejects.toThrow("INVOICE_VERSION_CONFLICT");
  });

  it("validates the complete bill and retains a full audit trail", async () => {
    const result = await writePurchaseInvoiceAllocation("VALIDATE", id, 1, revision, draft(), "Nadia", pool);
    expect(result.version).toBe(2);
    expect(result.approved?.amountHtCents).toBe(10000);
    expect(result.history).toHaveLength(2);
    const record = await pool.query<{ approved: { validatedBy: string }; history: unknown[] }>(
      "SELECT approved, history FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1", [id],
    );
    expect(record.rows[0]?.approved.validatedBy).toBe("Nadia");
    expect(record.rows[0]?.history).toHaveLength(2);
  });

  it("blocks potential duplicates and stale invoice revisions", async () => {
    await pool.query(
      "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) VALUES ('supplier_invoices',$1,$2::jsonb,NOW())",
      [otherId, JSON.stringify({ ...basePayload, id: Number(otherId) })],
    );
    await expect(writePurchaseInvoiceAllocation("VALIDATE", id, 2, revision, draft(), "Nadia", pool))
      .rejects.toThrow("INVOICE_POSSIBLE_DUPLICATE");
    await pool.query("DELETE FROM papot_pennylane_staging WHERE external_id=$1", [otherId]);
    await pool.query(
      "UPDATE papot_pennylane_staging SET payload = jsonb_set(payload, '{currency_amount_before_tax}', '\"101.00\"'::jsonb) WHERE resource='supplier_invoices' AND external_id=$1",
      [id],
    );
    await expect(writePurchaseInvoiceAllocation("VALIDATE", id, 2, revision, draft(), "Nadia", pool))
      .rejects.toThrow("INVOICE_SOURCE_CHANGED");
  });
});
