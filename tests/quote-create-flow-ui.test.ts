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
const quotesRoute = readFileSync(
  new URL("../src/app/api/desktop/quotes/route.ts", import.meta.url),
  "utf-8",
);

describe("quote creation flow", () => {
  it("permet de lancer un devis depuis la fiche affaire", () => {
    expect(affairQuotes).toContain("Créer un devis");
    expect(affairQuotes).toContain("/devis/nouveau?affaire=");
    expect(createPage).toContain('searchParams: Promise<{ affaire?: string; chantier?: string }>');
    expect(createPage).toContain("initialAffairId={initialAffairId}");
  });

  it("cree un TS chantier avec le meme moteur de devis sans repasser l'affaire en chiffrage", () => {
    expect(createPage).toContain("nextChantierComplementVariantName");
    expect(createPage).toContain('chantier === "1"');
    expect(createWorkspace).toContain("Travaux supplémentaires (TS)");
    expect(createWorkspace).toContain("quoteKind");
    expect(quotesRoute).toContain("quoteWorkflowMayChangeCommercialStatus");
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

  it("demande le responsable et la date puis passe l'affaire en chiffrage", () => {
    expect(createWorkspace).toContain("Responsable du chiffrage");
    expect(createWorkspace).toContain("Date prévue d’envoi");
    expect(createWorkspace).toContain("quoteOwnerName");
    expect(createWorkspace).toContain("quoteDueDate");
    expect(createPage).toContain("listCommercialAssignableUsers");
    expect(quotesRoute).toContain("startQuoteCommercialWorkflow");
    expect(quotesRoute).toContain('requireDesktopRequestContext("commercial", "WRITE")');
  });
});
