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
const clientVatPanel = readFileSync(
  new URL("../src/components/client-vat-defaults-panel.tsx", import.meta.url),
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
    expect(legalEditor).toContain("Début, durée et fin / date limite des travaux sont obligatoires.");
    expect(directEditor).toContain("<QuoteLegalDetailsEditor");
  });

  it("permet un taux de TVA spécifique pour chaque ligne avec retour au défaut client", () => {
    expect(legalEditor).toContain("TVA par ligne");
    expect(legalEditor).toContain("Taux spécifique");
    expect(legalEditor).toContain("Taux client par défaut");
    expect(legalEditor).toContain("setLineVatRate");
    expect(legalEditor).toContain("Défaut");
  });

  it("expose le taux par défaut dans l'espace clients", () => {
    expect(clientVatPanel).toContain("TVA par défaut");
    expect(clientVatPanel).toContain('action: "updateVat"');
    expect(clientsPage).toContain("<ClientVatDefaultsPanel />");
  });

  it("fige côté serveur le taux de la fiche client sur le nouveau devis", () => {
    expect(quotesRoute).toContain("initializeQuoteVatFromClient");
    expect(quotesRoute).toContain("client.defaultVatRatePercent");
  });
});
