import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("téléchargement PDF provisoire d'une version archivée", () => {
  it("exige le droit Facturation en lecture et ne déclenche aucune émission", () => {
    const api = readFileSync(
      "src/app/api/desktop/billing/[draftId]/visa/[version]/pdf/route.ts",
      "utf8",
    );
    const panel = readFileSync("src/components/billing-visa-panel.tsx", "utf8");
    expect(api).toContain('requireModuleRequestContext("billing", "READ")');
    expect(api).toContain("visaVersions");
    expect(api).toContain("generateBillingVisaProvisionalPdf");
    expect(api).toContain('Content-Type": "application/pdf"');
    expect(api).toContain('Cache-Control": "private, no-store"');
    expect(api).not.toContain("pennylane");
    expect(panel).toContain("Télécharger le PDF provisoire");
  });
});
