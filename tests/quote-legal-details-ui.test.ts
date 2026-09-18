import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const legalEditor = readFileSync(
  new URL("../src/components/quote-legal-details-editor.tsx", import.meta.url),
  "utf-8",
);
const directEditor = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);
const clientsWorkspace = readFileSync(
  new URL("../src/components/clients-workspace.tsx", import.meta.url),
  "utf-8",
);
const clientsPage = readFileSync(new URL("../src/app/clients/page.tsx", import.meta.url), "utf-8");
const quotesRoute = readFileSync(
  new URL("../src/app/api/desktop/quotes/route.ts", import.meta.url),
  "utf-8",
);

describe("quote legal details UI", () => {
  it("affiche les trois données travaux dans le devis", () => {
    expect(legalEditor).toContain("Début des travaux");
    expect(legalEditor).toContain("Durée prévisionnelle");
    expect(legalEditor).toContain("Fin / date limite des travaux");
    expect(legalEditor).toContain(
      "Début, durée et fin / date limite des travaux sont obligatoires.",
    );
    expect(directEditor).toContain("<QuoteLegalDetailsEditor");
  });

  it("permet un taux de TVA spécifique pour chaque ligne avec retour au défaut client", () => {
    expect(legalEditor).toContain("Gérer la TVA à la ligne");
    expect(legalEditor).toContain("manageLineVat");
    expect(legalEditor).toContain("Toutes les lignes utilisent le taux client par défaut.");
    expect(legalEditor).toContain("Taux spécifique");
    expect(legalEditor).toContain("Taux client par défaut");
    expect(legalEditor).toContain("setLineVatRate");
    expect(legalEditor).toContain("Défaut");
  });

  it("intègre le taux par défaut directement dans la fiche client", () => {
    expect(clientsWorkspace).toContain("TVA par défaut");
    expect(clientsWorkspace).toContain("defaultVatRatePercent");
    expect(clientsWorkspace).toContain('aria-label="TVA par défaut du client"');
    expect(clientsPage).not.toContain("ClientVatDefaultsPanel");
  });

  it("fige côté serveur le taux de la fiche client sur le nouveau devis", () => {
    expect(quotesRoute).toContain("initializeQuoteVatFromClient");
    expect(quotesRoute).toContain("client.defaultVatRatePercent");
  });
});
