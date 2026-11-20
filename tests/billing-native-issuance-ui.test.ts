import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("émission native PAPOT protégée, sans Pennylane sortant", () => {
  it("n'attribue des numéros que par une route à privilège explicite et désactivée par défaut", () => {
    const api = readFileSync("src/app/api/desktop/billing/issue/route.ts", "utf8");
    const env = readFileSync(".env.example", "utf8");
    const rights = readFileSync("src/lib/auth/permission-catalog.ts", "utf8");
    expect(api).toContain('requireModuleRequestContext("billing", "WRITE")');
    expect(api).toContain('requireSpecialPermission(context.user, "billing.issue_invoices")');
    expect(api).toContain('PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED !== "true"');
    expect(api).toContain("generateNativeInvoicePdf(issued)");
    expect(env).toContain("PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED=false");
    expect(rights).toContain('key: "billing.issue_invoices"');
    expect(api).not.toContain('"/api/external/v2/');
    expect(api).not.toContain("synchronizePennylane");
  });

  it("la facture définitive se télécharge depuis le registre figé et non depuis le brouillon", () => {
    const pdf = readFileSync("src/app/api/desktop/billing/issued/[invoiceId]/pdf/route.ts", "utf8");
    const editor = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    const billing = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    expect(pdf).toContain("nativeInvoiceLedger?.invoices.find");
    expect(pdf).toContain("generateNativeInvoicePdf(invoice)");
    expect(editor).toContain("Émettre la facture et attribuer son numéro définitif");
    expect(editor).toContain("/api/desktop/billing/issue");
    expect(editor).toContain("/api/desktop/billing/issued/");
    expect(billing).toContain("delete safe.nativeInvoiceLedger");
    expect(billing).toContain("issuedInvoices:");
  });
});
