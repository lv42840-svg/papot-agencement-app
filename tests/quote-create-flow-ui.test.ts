import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const affairQuotes = readFileSync(
  new URL("../src/components/commercial-affair-quotes.tsx", import.meta.url),
  "utf-8",
);
const createWorkspace = readFileSync(
  new URL("../src/components/quote-create-workspace.tsx", import.meta.url),
  "utf-8",
);
const createPage = readFileSync(
  new URL("../src/app/devis/nouveau/page.tsx", import.meta.url),
  "utf-8",
);

describe("quote creation flow", () => {
  it("permet de lancer un devis depuis la fiche affaire", () => {
    expect(affairQuotes).toContain("Créer un devis");
    expect(affairQuotes).toContain("/devis/nouveau?affaire=");
    expect(createPage).toContain("searchParams: Promise<{ affaire?: string }>");
    expect(createPage).toContain("initialAffairId={initialAffairId}");
  });

  it("cree le premier devis automatiquement en Base V1", () => {
    expect(createWorkspace).toContain('variantName: "Base"');
    expect(createWorkspace).toContain("Base · V1");
    expect(createWorkspace).not.toContain("setVariantName");
    expect(createWorkspace).not.toMatch(/<span>Variante<\/span>\s*<input/);
  });

  it("utilise les conditions de reglement en liste controlee", () => {
    expect(createWorkspace).toMatch(/<span>Conditions de règlement<\/span>\s*<select/);
    expect(createWorkspace).toContain("availablePaymentTerms.map");
    expect(createPage).toContain("clients.clients");
  });

  it("rappelle que la validite est toujours de 30 jours", () => {
    expect(createWorkspace).toContain("Validité du devis : 30 jours");
    expect(createWorkspace).not.toContain("validityDays");
  });
});
