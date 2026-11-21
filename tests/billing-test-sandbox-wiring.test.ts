import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const code = (path: string) => readFileSync(path, "utf8");

describe("bac à sable facturation : aucune suppression ou émission fiscale", () => {
  it("verrouille le mode test derrière un interrupteur et un droit dédié", () => {
    const route = code("src/app/api/desktop/billing/test-sandbox/route.ts");
    const env = code(".env.example");
    const catalog = code("src/lib/auth/permission-catalog.ts");
    expect(route).toContain('requireModuleRequestContext("billing", "WRITE")');
    expect(route).toContain('requireSpecialPermission(context.user, "billing.test_sandbox")');
    expect(route).toContain('requireSpecialPermission(context.user, "billing.reset_test_sandbox")');
    expect(route).toContain('PAPOT_BILLING_TEST_SANDBOX_ENABLED !== "true"');
    expect(env).toContain("PAPOT_BILLING_TEST_SANDBOX_ENABLED=false");
    expect(catalog).toContain('key: "billing.test_sandbox"');
    expect(catalog).toContain('key: "billing.reset_test_sandbox"');
  });

  it("le reset ne touche pas les registres officiels ni les archives, jamais Pennylane", () => {
    const route = code("src/app/api/desktop/billing/test-sandbox/route.ts");
    const sandbox = code("src/lib/billing/test-sandbox.ts");
    expect(sandbox).toContain("testSandbox: {");
    expect(sandbox).toContain("...emptyBillingTestSandbox()");
    expect(sandbox).toContain("lastResetByName: actorName");
    expect(sandbox).not.toContain("deleteNativeInvoice");
    expect(route).toContain("resetBillingTestSandbox(");
    expect(route).not.toContain("storeOriginalNativeInvoicePdf(");
    expect(route).not.toContain("pennylane");
    expect(route).not.toContain("DELETE FROM papot_native_invoice_pdf_archive");
    expect(route).not.toContain("DELETE FROM papot_billing_state");
  });

  it("les PDF fictifs sont accessibles séparément et marqués non valables", () => {
    const pdf = code("src/app/api/desktop/billing/test-sandbox/pdf/[documentId]/route.ts");
    const regular = code("src/lib/billing/native-invoice-pdf.ts");
    const credit = code("src/lib/billing/native-credit-pdf.ts");
    expect(pdf).toContain("generateNativeInvoicePdf(found.invoice, { testOnly: true })");
    expect(pdf).toContain(
      "generateNativeCreditNotePdf(found.credit, found.original, { testOnly: true })",
    );
    expect(pdf).toContain('requireSpecialPermission(context.user, "billing.test_sandbox")');
    expect(pdf).not.toContain("loadOriginalNativeInvoicePdf");
    expect(regular).toContain("SPECIMEN - TEST - NON VALABLE");
    expect(credit).toContain("SPECIMEN - TEST - NON VALABLE");
  });

  it("le registre de tests n'est jamais exposé par la route standard", () => {
    const route = code("src/app/api/desktop/billing/route.ts");
    const workspace = code("src/components/billing-workspace.tsx");
    const panel = code("src/components/billing-test-sandbox-panel.tsx");
    expect(route).toContain("delete safe.testSandbox");
    expect(route).toContain('hasSpecialPermission(context.user.id, "billing.test_sandbox")');
    expect(workspace).toContain("data.canTestBillingSandbox");
    expect(panel).toContain("EFFACER LES ESSAIS");
    expect(panel).toContain("Supprimer les factures et avoirs TEST");
    expect(panel).toContain("TEST / SANS VALEUR FISCALE");
  });
});
