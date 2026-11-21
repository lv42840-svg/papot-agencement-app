import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("avoirs officiels PAPOT : garde-fous V1", () => {
  it("nécessite un droit distinct et deux activations explicites", () => {
    const api = readFileSync("src/app/api/desktop/billing/credits/issue/route.ts", "utf8");
    const env = readFileSync(".env.example", "utf8");
    const rights = readFileSync("src/lib/auth/permission-catalog.ts", "utf8");
    expect(api).toContain('requireModuleRequestContext("billing", "WRITE")');
    expect(api).toContain('requireSpecialPermission(context.user, "billing.issue_credit_notes")');
    expect(api).toContain('PAPOT_NATIVE_CREDIT_NOTES_ENABLED !== "true"');
    expect(api).toContain('PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED !== "true"');
    expect(env).toContain("PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED=false");
    expect(env).toContain("PAPOT_NATIVE_CREDIT_NOTES_ENABLED=false");
    expect(rights).toContain('key: "billing.issue_credit_notes"');
    expect(api).not.toContain("synchronizePennylane");
    expect(api).not.toContain('"/api/external/v2/');
  });

  it("persiste le PDF et l'avoir dans une transaction, sans régénération sur les replays", () => {
    const api = readFileSync("src/app/api/desktop/billing/credits/issue/route.ts", "utf8");
    const pdf = readFileSync(
      "src/app/api/desktop/billing/credits/issued/[creditId]/pdf/route.ts",
      "utf8",
    );
    expect(api).toContain("repository.mutate(async (current)");
    expect(api).toContain("generateNativeCreditNotePdf(note, original)");
    expect(api).toContain("await storeOriginalNativeInvoicePdf(note, pdf)");
    expect(api).toContain("await loadOriginalNativeInvoicePdf(note)");
    expect(pdf).toContain('requireModuleRequestContext("billing", "READ")');
    expect(pdf).toContain("loadOriginalNativeInvoicePdf(note)");
    expect(pdf).not.toContain("generateNativeCreditNotePdf");
  });

  it("affiche les plafonds de TVA, les avoirs archivés et le téléchargement", () => {
    const editor = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    const api = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    expect(editor).toContain("Avoirs officiels liés à");
    expect(editor).toContain("/api/desktop/billing/credits/issue");
    expect(editor).toContain("/api/desktop/billing/credits/issued/");
    expect(editor).toContain("Émettre l&apos;avoir officiel et attribuer son numéro");
    expect(api).toContain("delete safe.nativeCreditNoteLedger");
    expect(api).toContain("creditPositions:");
    expect(api).toContain("issuedCreditNotes:");
    expect(api).toContain("canIssueCredits:");
  });
});
