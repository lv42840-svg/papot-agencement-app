import { describe, expect, it } from "vitest";
import {
  commercialAffairFolderName,
  commercialDocumentFileName,
  commercialDocumentFolderName,
  commercialDocumentStoragePath,
} from "../src/lib/commercial/document-path";

describe("commercial document path", () => {
  it("builds the readable physical hierarchy requested for new documents", () => {
    expect(
      commercialDocumentStoragePath({
        creationYear: 2026,
        clientName: "Dupont",
        caseName: "Cuisine Lyon",
        category: "RECEIVED",
        fileName: "plan client.pdf",
      }),
    ).toBe("Commercial/2026/Dupont_Cuisine Lyon/Documents reçus/plan client.pdf");
  });

  it("uses clear business folder names for every commercial classification", () => {
    expect(commercialDocumentFolderName("RECEIVED")).toBe("Documents reçus");
    expect(commercialDocumentFolderName("INTERNAL_QUOTING")).toBe("Chiffrage interne");
    expect(commercialDocumentFolderName("QUOTE")).toBe("Devis");
    expect(commercialDocumentFolderName("COSTING")).toBe("Déboursé");
    expect(commercialDocumentFolderName("MISC")).toBe("Divers");
  });

  it("sanitizes Windows-invalid characters without exposing technical identifiers", () => {
    expect(commercialAffairFolderName("ACME / Loire", "Cuisine: étage 1")).toBe(
      "ACME - Loire_Cuisine- étage 1",
    );
    expect(commercialDocumentFileName("plan:final?.pdf")).toBe("plan-final-.pdf");
  });

  it("keeps a readable fallback when the client is not yet identified", () => {
    expect(commercialAffairFolderName(null, "Cuisine Roanne")).toBe(
      "Client à préciser_Cuisine Roanne",
    );
  });
});
