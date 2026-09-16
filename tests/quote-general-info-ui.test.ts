import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync(
  new URL("../src/components/quote-general-info-editor.tsx", import.meta.url),
  "utf-8",
);
const page = readFileSync(new URL("../src/app/devis/[quoteId]/page.tsx", import.meta.url), "utf-8");

describe("quote general info UI", () => {
  it("garde client et affaire en lecture seule avec le message de liaison", () => {
    expect(editor).toContain("Le client et l’affaire restent liés au");
    expect(editor).toContain("{clientName}");
    expect(editor).toContain("{affairName}");
    expect(editor).not.toContain("value={clientName}");
    expect(editor).not.toContain("value={affairName}");
  });

  it("garde l'objet sur un input simple et compact sans textarea", () => {
    expect(editor).toMatch(/<span>Objet<\/span>\s*<input/);
    expect(editor).not.toContain("<textarea");
    expect(editor).not.toContain("contentEditable");
  });

  it("affiche la variante sans saisie libre", () => {
    expect(editor).toMatch(
      /<span>Variante<\/span>\s*<div className="quoteGeneralStructuredValue">/,
    );
    expect(editor).not.toContain("setVariantName");
    expect(editor).not.toContain("variantName,");
  });

  it("utilise une sélection structurée pour les conditions de règlement", () => {
    expect(editor).toMatch(/<span>Conditions de règlement<\/span>\s*<select/);
    expect(editor).toContain("availablePaymentTerms.map");
    expect(page).toContain("clients.clients.map((candidate) => candidate.paymentTerms)");
  });

  it("ne présente plus de champ de validité dans ce bloc", () => {
    expect(editor).not.toContain("<span>Validité</span>");
    expect(editor).not.toContain("validityDays");
    expect(editor).not.toContain("quoteGeneralValidity");
  });
});
