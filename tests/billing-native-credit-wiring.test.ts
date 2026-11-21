import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("avoirs V1 : contrôles émission, droits, archive et affichage", () => {
  it("n'émet rien sans droit spécifique et activation explicite, jamais vers Pennylane", () => {
    const api = read("src/app/api/desktop/billing/credits/issue/route.ts");
    const env = read(".env.example");
    const rights = read("src/lib/auth/permission-catalog.ts");
    expect(api).toContain('requireModuleRequestContext("billing", "WRITE")');
    expect(api).toContain('requireSpecialPermission(context.user, "billing.issue_credit_notes")');
    expect(api).toContain('PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED !== "true"');
    expect(api).toContain('PAPOT_NATIVE_CREDIT_NOTES_ENABLED !== "true"');
    expect(env).toContain("PAPOT_NATIVE_CREDIT_NOTES_ENABLED=false");
    expect(rights).toContain('key: "billing.issue_credit_notes"');
    expect(api).not.toContain("/api/external/v2/");
    expect(api).not.toContain("synchronizePennylane");
  });

  it("archive les octets du PDF et retourne l'archive historique sur un retry", () => {
    const api = read("src/app/api/desktop/billing/credits/issue/route.ts");
    const pdf = read("src/app/api/desktop/billing/credits/issued/[creditId]/pdf/route.ts");
    expect(api).toContain("repository.mutate(async (current)");
    expect(api).toContain("await storeOriginalNativeInvoicePdf(note, pdf)");
    expect(api).toContain("await loadOriginalNativeInvoicePdf(note)");
    expect(pdf).toContain("loadOriginalNativeInvoicePdf(note)");
    expect(pdf).toContain("Buffer.from(archived.bytes)");
    expect(pdf).not.toContain("generateNativeCreditNotePdf");
  });

  it("la route lecteur n'expose ni facture intégrale ni journal des avoirs", () => {
    const route = read("src/app/api/desktop/billing/route.ts");
    expect(route).toContain("delete safe.nativeInvoiceLedger");
    expect(route).toContain("delete safe.nativeCreditNoteLedger");
    expect(route).toContain("issuedCreditNotes:");
    expect(route).toContain("creditPositions:");
    expect(route).toContain('hasSpecialPermission(context.user.id, "billing.issue_credit_notes")');
  });

  it("l'écran annonce un aperçu valide avant la demande irréversible", () => {
    const editor = read("src/components/billing-document-editor.tsx");
    expect(editor).toContain("previewNativeCreditNote");
    expect(editor).toContain("!creditPreview?.valid");
    expect(editor).toContain("Crédit TTC à émettre");
    expect(editor).toContain("Reste TTC après émission");
    expect(editor).toContain("/api/desktop/billing/credits/issue");
    expect(editor).toContain("/api/desktop/billing/credits/issued/");
    expect(editor).toContain("Émettre l&apos;avoir officiel");
  });
});
