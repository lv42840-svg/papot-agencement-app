import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("visa extérieur des factures provisoires", () => {
  it("garde un état indépendant du verrouillage interne et permet les décisions documentées", () => {
    const ui = readFileSync("src/components/billing-visa-panel.tsx", "utf8");
    const editor = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    const api = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    expect(ui).toContain("Enregistrer la présentation provisoire");
    expect(ui).toContain("Accepté partiellement");
    expect(ui).toContain("Retirer cette présentation");
    expect(ui).toContain("Historique des présentations");
    expect(ui).toContain("Aucun e-mail");
    expect(editor).toContain("<BillingVisaPanel");
    expect(editor).toContain("visaBlocksApproval");
    expect(api).toContain('z.literal("PRESENT_VISA")');
    expect(api).toContain('z.literal("REVIEW_VISA")');
    expect(api).toContain('z.literal("WITHDRAW_VISA")');
    expect(api).toContain("BILLING_VISA_HISTORY_PROTECTED");
  });
});
