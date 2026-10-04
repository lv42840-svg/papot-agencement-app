import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const newQuotePage = readFileSync(
  new URL("../src/app/devis/nouveau/page.tsx", import.meta.url),
  "utf-8",
);
const commercialV2 = readFileSync(
  new URL("../src/components/commercial-workspace-v2.tsx", import.meta.url),
  "utf-8",
);

describe("Affaire to Devis web flow", () => {
  it("keeps the new quote page independent from the desktop runtime", () => {
    expect(newQuotePage).not.toContain("requireDesktopRequestContext");
    expect(newQuotePage).toContain("requireModuleRequestContext");
    expect(newQuotePage).toContain("createCommercialRepository()");
    expect(newQuotePage).toContain("createClientsRepository()");
  });

  it("allows explicit payment terms when the provisional client has none", () => {
    expect(
      readFileSync(
        new URL("../src/components/quote-create-workspace.tsx", import.meta.url),
        "utf-8",
      ),
    ).toContain("Saisir les conditions de règlement");
  });

  it("preserves the displayed Affaire revision and exposes Create quote", () => {
    expect(commercialV2).toContain("expectedUpdatedAt: selected.updatedAt");
    expect(commercialV2).toContain('form.set("expectedUpdatedAt", expectedUpdatedAt)');
    expect(commercialV2).toContain("/devis/nouveau?affaire=");
    expect(commercialV2).toContain("Créer un devis");
  });
});
