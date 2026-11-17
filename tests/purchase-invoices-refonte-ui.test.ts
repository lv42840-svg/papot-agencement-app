import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateNumericExpression } from "../src/lib/numeric-expression";

const source = (path: string) => readFileSync(path, "utf8");

describe("refonte de l'onglet Factures fournisseurs", () => {
  it("sépare les 500 dernières factures et les affectations validées PAPOT", () => {
    const workspace = source("src/components/purchase-invoices-workspace.tsx");
    const store = source("src/lib/pennylane/purchase-invoice-store.ts");
    expect(workspace).toContain("Toutes les factures");
    expect(workspace).toContain("Factures validées");
    expect(workspace).toContain('invoiceTab === "APPROVED"');
    expect(workspace).toContain("data.validatedInvoices");
    expect(store).toContain("validatedInvoices:");
    expect(store).toContain("a.approved IS NOT NULL");
    expect(store).toContain("ORDER BY a.updated_at DESC LIMIT 501");
    expect(store).toContain("ORDER BY external_id DESC LIMIT 501");
  });

  it("filtre les BC liés par date et client, et affiche la date d'émission du BC", () => {
    const workspace = source("src/components/purchase-invoices-workspace.tsx");
    const store = source("src/lib/pennylane/purchase-invoice-store.ts");
    expect(workspace).toContain("orderSearch");
    expect(workspace).toContain("orderFrom");
    expect(workspace).toContain("orderTo");
    expect(workspace).toContain("order.clientName");
    expect(workspace).toContain("order.createdAt.slice(0, 10)");
    expect(workspace).toContain("proposal.clientName");
    expect(workspace).toContain("proposal.createdAt");
    expect(store).toContain("clientName:");
    expect(store).toContain("createdAt: order.createdAt");
  });

  it("propose un montant global avec calculs et recopie du total HT pour un seul chantier", () => {
    const workspace = source("src/components/purchase-invoices-workspace.tsx");
    const amount = source("src/components/calculated-amount-input.tsx");
    expect(workspace).not.toContain("Ligne par ligne");
    expect(workspace).not.toContain('mode: "LINES"');
    expect(workspace).toContain("asGlobalDraft");
    expect(workspace).toContain("Reprendre le total HT de la facture");
    expect(workspace).toContain('row.destination.kind === "CHANTIER"');
    expect(workspace).toContain("draft.rows.length === 1");
    expect(workspace.match(/<CalculatedAmountInput/g)?.length).toBe(3);
    expect(amount).toContain("evaluateNumericExpression");
    expect(amount).toContain('inputMode="decimal"');
    expect(evaluateNumericExpression("250+125", 2)).toBe(375);
    expect(evaluateNumericExpression("(120+30)*2", 2)).toBe(300);
  });

  it("conserve les coûts historiques en cas de disparition de la source sans double compter", () => {
    const store = source("src/lib/pennylane/store.ts");
    const costs = source("src/lib/pennylane/purchase-invoice-store.ts");
    const migrations = source("src/lib/server-db/migrations.ts");
    expect(store).toContain("papot_pennylane_supplier_invoice_archive");
    expect(store).toContain("a.approved IS NOT NULL");
    expect(store).toContain("DELETE FROM papot_pennylane_staging");
    expect(costs).toContain("COALESCE(s.payload, h.payload)");
    expect(costs).toContain("row.source_missing");
    expect(migrations).toContain("PENNYLANE_SUPPLIER_INVOICE_ARCHIVE_VERSION = 21");
  });
});
