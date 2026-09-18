import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directEditor = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);

const sendAction = readFileSync(
  new URL("../src/components/quote-send-action.tsx", import.meta.url),
  "utf-8",
);

describe("quote final PDF action visibility", () => {
  it("expose l'action de génération et gel dans l'interface active du devis", () => {
    expect(directEditor).toContain("QuoteSendAction");
    expect(directEditor).toContain("QuoteComponentCheck");
    expect(directEditor).toContain("QuoteLifecycleActions");
  });

  it("n'attribue pas une erreur PDF inconnue a la date de relance", () => {
    expect(sendAction).toContain('code === "QUOTE_FOLLOW_UP_DATE_REQUIRED"');
    expect(sendAction).toContain("La date de relance n’est pas forcément en cause.");
    expect(sendAction).toContain("QUOTE_DOCUMENT_PRICING_WARNING");
    expect(sendAction).toContain("PDF_CONVERTER_UNAVAILABLE");
    expect(sendAction).toContain("Installe LibreOffice ou Microsoft Word");
    expect(sendAction).toContain("PDF_WINDOWS_CONVERTER_FAILED");
    expect(sendAction).toContain("dossier d’archivage PAPOT");
  });
});
