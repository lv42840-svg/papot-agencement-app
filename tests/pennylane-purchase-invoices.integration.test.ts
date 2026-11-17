import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import {
  readPurchaseInvoiceWorkspace,
  readValidatedPurchaseCosts,
  writePurchaseInvoiceAllocation,
  autoAllocateImportedGeneralExpensesInvoices,
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
    rows: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceLineId: null,
        destination: { kind: "GENERAL_EXPENSES", chantierId: null },
        amountHtCents: 10000,
      },
    ],
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
      [
        supplier,
        JSON.stringify({ id: Number(supplier), name: "Fournisseur de test" }),
        id,
        JSON.stringify(basePayload),
      ],
    );
    await pool.query(
      "INSERT INTO papot_pennylane_sync_state (resource, company_name, synced_at, item_count) VALUES ('supplier_invoices','PAPOT LIBERAL',NOW(),1) ON CONFLICT (resource) DO UPDATE SET synced_at=NOW(), item_count=1",
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(
      "DELETE FROM papot_pennylane_purchase_allocations WHERE invoice_id IN ($1, $2)",
      [id, otherId],
    );
    await pool.query("DELETE FROM papot_pennylane_staging WHERE external_id IN ($1, $2, $3)", [
      id,
      otherId,
      supplier,
    ]);
    await pool.query("DELETE FROM papot_pennylane_sync_state WHERE resource = 'supplier_invoices'");
    await closeServerDbPool();
  });

  it("reads a real V2 EUR amount and stores a draft without real costs", async () => {
    const data = await readPurchaseInvoiceWorkspace(pool);
    const invoice = data.invoices.find((item) => item.id === id)!;
    expect(invoice).toBeTruthy();
    expect(invoice.amountHtCents).toBe(10000);
    expect(invoice.supplierName).toBe("Fournisseur de test");
    revision = invoice.sourceRevision;
    const incomplete = { ...draft(), rows: [] };
    const result = await writePurchaseInvoiceAllocation(
      "SAVE",
      id,
      0,
      revision,
      incomplete,
      "Nadia",
      pool,
    );
    expect(result.version).toBe(1);
    expect(result.approved).toBeNull();
    const costs = await readValidatedPurchaseCosts(pool);
    expect(costs.imported).toBe(true);
    expect(costs.byChantier).toEqual({});
  });

  it("refuses an incomplete validation and protects against outdated versions", async () => {
    await expect(
      writePurchaseInvoiceAllocation(
        "VALIDATE",
        id,
        1,
        revision,
        {
          ...draft(),
          rows: [],
        },
        "Nadia",
        pool,
      ),
    ).rejects.toThrow("INVOICE_ALLOCATION_INCOMPLETE");
    await expect(
      writePurchaseInvoiceAllocation("SAVE", id, 0, revision, draft(), "Nadia", pool),
    ).rejects.toThrow("INVOICE_VERSION_CONFLICT");
  });

  it("validates the complete bill and retains a full audit trail", async () => {
    const result = await writePurchaseInvoiceAllocation(
      "VALIDATE",
      id,
      1,
      revision,
      draft(),
      "Nadia",
      pool,
    );
    expect(result.version).toBe(2);
    expect(result.approved?.amountHtCents).toBe(10000);
    expect(result.history).toHaveLength(2);
    const record = await pool.query<{ approved: { validatedBy: string }; history: unknown[] }>(
      "SELECT approved, history FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1",
      [id],
    );
    expect(record.rows[0]?.approved.validatedBy).toBe("Nadia");
    expect(record.rows[0]?.history).toHaveLength(2);
  });

  it("blocks potential duplicates and stale invoice revisions", async () => {
    await pool.query(
      "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) VALUES ('supplier_invoices',$1,$2::jsonb,NOW())",
      [otherId, JSON.stringify({ ...basePayload, id: Number(otherId) })],
    );
    await expect(
      writePurchaseInvoiceAllocation("VALIDATE", id, 2, revision, draft(), "Nadia", pool),
    ).rejects.toThrow("INVOICE_POSSIBLE_DUPLICATE");
    await pool.query("DELETE FROM papot_pennylane_staging WHERE external_id=$1", [otherId]);
    await pool.query(
      "UPDATE papot_pennylane_staging SET payload = jsonb_set(payload, '{currency_amount_before_tax}', '\"101.00\"'::jsonb) WHERE resource='supplier_invoices' AND external_id=$1",
      [id],
    );
    await expect(
      writePurchaseInvoiceAllocation("VALIDATE", id, 2, revision, draft(), "Nadia", pool),
    ).rejects.toThrow("INVOICE_SOURCE_CHANGED");
  });
  it("valide immédiatement les FG éligibles dans PAPOT une seule fois, même avant Pennylane", async () => {
    const { parsePurchaseOrdersPayload } = await import("../src/lib/purchases/domain");
    const saved = await pool.query<{ payload: unknown }>(
      "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'",
    );
    const original = saved.rows[0]?.payload;
    const preferences = {
      ...parsePurchaseOrdersPayload(original),
      supplierPreferences: [
        { supplierPennylaneId: supplier, defaultDestination: "GENERAL_EXPENSES" },
      ],
    };
    await pool.query(
      "UPDATE papot_purchase_orders_state SET payload=$1::jsonb WHERE scope='global'",
      [JSON.stringify(preferences)],
    );
    try {
      await pool.query(
        "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) VALUES ('supplier_invoices',$1,$2::jsonb,NOW())",
        [
          otherId,
          JSON.stringify({
            ...basePayload,
            id: Number(otherId),
            invoice_number: "FG-AUTO-UNIQUE-2026",
            accounting_status: "pending",
            currency_amount_before_tax: "49.15",
          }),
        ],
      );
      const first = await autoAllocateImportedGeneralExpensesInvoices("Lucien", pool);
      expect(first.supplierCount).toBe(1);
      expect(first.assigned).toBe(1);
      expect(first.skippedExisting).toBeGreaterThanOrEqual(1);
      const read = await pool.query<{
        version: number;
        draft: InvoiceAllocationDraft;
        approved: { validatedBy: string; amountHtCents: number; sourceRevision: string } | null;
        history: Array<{ action: string; actor: string }>;
      }>(
        "SELECT version, draft, approved, history FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1",
        [otherId],
      );
      expect(read.rows[0].version).toBe(1);
      expect(read.rows[0].draft.rows[0].destination).toEqual({
        kind: "GENERAL_EXPENSES",
        chantierId: null,
      });
      expect(read.rows[0].draft.rows[0].amountHtCents).toBe(4915);
      expect(read.rows[0].approved).toMatchObject({
        validatedBy: "Lucien",
        amountHtCents: 4915,
      });
      const imported = await readPurchaseInvoiceWorkspace(pool);
      expect(imported.invoices.find((item) => item.id === otherId)?.workflow).toBe(
        "AWAITING_PENNYLANE",
      );
      expect(read.rows[0].history[0]).toMatchObject({ actor: "Lucien", action: "VALIDATE" });
      const second = await autoAllocateImportedGeneralExpensesInvoices("Nadia", pool);
      expect(second.assigned).toBe(0);
      expect(second.skippedExisting).toBeGreaterThanOrEqual(2);
      const after = await pool.query<{ version: number; history: unknown[] }>(
        "SELECT version, history FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1",
        [otherId],
      );
      expect(after.rows[0]).toMatchObject({ version: 1 });
      expect(after.rows[0].history).toHaveLength(1);
    } finally {
      await pool.query("DELETE FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1", [
        otherId,
      ]);
      await pool.query(
        "DELETE FROM papot_pennylane_staging WHERE resource='supplier_invoices' AND external_id=$1",
        [otherId],
      );
      await pool.query(
        "UPDATE papot_purchase_orders_state SET payload=$1::jsonb WHERE scope='global'",
        [JSON.stringify(original)],
      );
    }
  });
  it("ne valide jamais automatiquement une facture d'un fournisseur FG ayant un BC chantier à rapprocher", async () => {
    const { addPurchaseOrder, parsePurchaseOrdersPayload } = await import("../src/lib/purchases/domain");
    const thirdId = "987654321015";
    const otherSupplier = "987654321016";
    const chantierId = "77777777-7777-4777-8777-777777777777";
    const original = (await pool.query<{ payload: unknown }>(
      "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'",
    )).rows[0]?.payload;
    const purchase = addPurchaseOrder(
      parsePurchaseOrdersPayload(original),
      "88888888-8888-4888-8888-888888888888",
      {
        mode: "QUICK",
        allocations: [{ chantierId, destinationType: "CHANTIER", amountHtCents: 2500 }],
        supplierName: "Fournisseur chantiers",
        supplierPennylaneId: otherSupplier,
        description: "BC à rapprocher manuellement",
      },
      new Map([[chantierId, "Chantier essai"]]),
      "Lucien",
    );
    await pool.query(
      "UPDATE papot_purchase_orders_state SET payload=$1::jsonb WHERE scope='global'",
      [JSON.stringify({
        ...purchase,
        supplierPreferences: [
          { supplierPennylaneId: otherSupplier, defaultDestination: "GENERAL_EXPENSES" },
        ],
      })],
    );
    try {
      await pool.query(
        "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) VALUES ('supplier_invoices',$1,$2::jsonb,NOW())",
        [thirdId, JSON.stringify({
          ...basePayload,
          id: Number(thirdId),
          supplier: { id: Number(otherSupplier) },
          invoice_number: "FC-CHANTIER-INCERTAIN",
          currency_amount_before_tax: "25.00",
        })],
      );
      const batch = await autoAllocateImportedGeneralExpensesInvoices("PAPOT · synchronisation", pool);
      expect(batch.skippedChantierOrder).toBe(1);
      expect(batch.assigned).toBe(0);
      const state = await pool.query(
        "SELECT approved FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1",
        [thirdId],
      );
      expect(state.rows).toHaveLength(0);
    } finally {
      await pool.query("DELETE FROM papot_pennylane_staging WHERE resource='supplier_invoices' AND external_id=$1", [thirdId]);
      await pool.query("DELETE FROM papot_pennylane_purchase_allocations WHERE invoice_id=$1", [thirdId]);
      await pool.query("UPDATE papot_purchase_orders_state SET payload=$1::jsonb WHERE scope='global'", [JSON.stringify(original)]);
    }
  });

});
