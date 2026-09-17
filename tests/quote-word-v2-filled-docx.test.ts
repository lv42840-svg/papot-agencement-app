import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cloneZipEntryWithData,
  readZipArchive,
  writeZipArchive,
} from "../src/lib/documents/zip-archive";
import type { QuoteDocumentData } from "../src/lib/quotes/document-data";
import {
  assertQuoteWordV2FilledDocx,
  renderQuoteWordV2FilledDocx,
} from "../src/lib/quotes/word-v2-filled-docx";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const manifestPath = new URL(
  "../docs/templates/PAPOT_Template_Devis_V2.manifest.json",
  import.meta.url,
);

type TemplateManifest = {
  scalarTokens: string[];
  dynamicAnchors: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TemplateManifest;

function makeDocument(): QuoteDocumentData {
  return {
    quote: {
      id: "11111111-1111-4111-8111-111111111111",
      number: "D-2026-0042",
      variantName: "Base",
      version: 2,
      versionLabel: "Base V2",
      issueDate: "2026-09-17",
      validityDate: "2026-10-17",
      subject: "Agencement accueil",
      paymentTerms: "45 jours fin de mois",
      workStartDate: "2026-10-05",
      workDuration: "2 semaines",
      workEndDate: "2026-10-16",
    },
    company: {
      name: "SOCIETE TEST",
      addressLine1: "1 rue de Test",
      postalCode: "42000",
      city: "Saint-Etienne",
      legalForm: "SAS",
      capital: "1 000 EUR",
      siret: "12345678901234",
      rcs: "RCS TEST",
      ape: "4332A",
      vatNumber: "FR00123456789",
      phone: "0400000000",
      email: "societe@example.com",
      insurerName: "ASSUREUR TEST",
      insurerAddress: "2 rue Assurance",
      insuranceCoverage: "France",
      bankName: "BANQUE TEST",
      bankAccountHolder: "SOCIETE TEST",
      iban: "FR7612345678901234567890123",
      bic: "TESTFRPP",
      paymentMethods: "Virement",
      chequePayee: "SOCIETE TEST",
    },
    client: {
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "CLIENT TEST",
      contactName: "Alice Martin",
      addressLine1: "10 rue du Client",
      addressLine2: "",
      postalCode: "69001",
      city: "Lyon",
      country: "France",
      identifierLabel: "SIRET",
      identifier: "98765432109876",
    },
    affair: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Accueil siege social",
      siteLabel: "Siege Lyon",
      siteAddressLine1: "25 rue du Chantier",
      siteAddressLine2: "",
      sitePostalCode: "69002",
      siteCity: "Lyon",
    },
    items: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        kind: "SECTION",
        number: "1",
        parentId: null,
        text: "Mobilier accueil",
        richText: null,
        clientPhotos: [],
        scope: "MAIN",
        optionId: null,
        optionLabel: null,
        optionStatus: null,
        quantity: null,
        unit: null,
        unitPriceHt: null,
        totalHtCents: null,
        vatRatePercent: null,
        vatCents: null,
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        kind: "LINE",
        number: "1.1",
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "Fabrication banque accueil",
        richText: null,
        clientPhotos: [],
        scope: "MAIN",
        optionId: null,
        optionLabel: null,
        optionStatus: null,
        quantity: 1,
        unit: "u",
        unitPriceHt: 1000,
        totalHtCents: 100000,
        vatRatePercent: 20,
        vatCents: 20000,
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        kind: "LINE",
        number: "1.2",
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "Habillage mural",
        richText: null,
        clientPhotos: [],
        scope: "MAIN",
        optionId: null,
        optionLabel: null,
        optionStatus: null,
        quantity: 1,
        unit: "u",
        unitPriceHt: 500,
        totalHtCents: 50000,
        vatRatePercent: 10,
        vatCents: 5000,
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        kind: "LINE",
        number: "1.3",
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "Eclairage decoratif",
        richText: null,
        clientPhotos: [],
        scope: "PENDING_OPTION",
        optionId: "88888888-8888-4888-8888-888888888888",
        optionLabel: "Option eclairage",
        optionStatus: "PENDING",
        quantity: 1,
        unit: "u",
        unitPriceHt: 300,
        totalHtCents: 30000,
        vatRatePercent: 20,
        vatCents: 6000,
      },
    ],
    totals: {
      totalHtCents: 150000,
      totalVatCents: 25000,
      totalTtcCents: 175000,
      taxLines: [
        { ratePercent: 10, baseHtCents: 50000, vatCents: 5000 },
        { ratePercent: 20, baseHtCents: 100000, vatCents: 20000 },
      ],
    },
    pendingOptions: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        label: "Option eclairage",
        totalHtCents: 30000,
        totalVatCents: 6000,
        totalTtcCents: 36000,
      },
    ],
  };
}

function allWordXml(docx: Uint8Array): string {
  return readZipArchive(docx)
    .filter((entry) => entry.name.startsWith("word/") && entry.name.endsWith(".xml"))
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
    .join("\n");
}

function xmlText(value: string): string {
  return value
    .replaceAll(/<w:br\s*\/>/g, "\n")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

describe("quote Word V2 filled DOCX", () => {
  it("produit depuis le vrai template un DOCX complet sans token restant", () => {
    const rendered = renderQuoteWordV2FilledDocx(readFileSync(templatePath), makeDocument());
    const xml = allWordXml(rendered);
    const text = xmlText(xml);

    expect(Buffer.from(rendered).subarray(0, 2).toString("ascii")).toBe("PK");

    for (const token of manifest.scalarTokens) {
      expect(xml).not.toContain(`{{${token}}}`);
    }
    for (const anchor of Object.keys(manifest.dynamicAnchors)) {
      expect(xml).not.toContain(`{{${anchor}}}`);
    }

    expect(text).toContain("SOCIETE TEST");
    expect(text).toContain("CLIENT TEST");
    expect(text).toContain("D-2026-0042");
    expect(text).toContain("Fabrication banque accueil");
    expect(text).toContain("Habillage mural");
    expect(text).toContain("OPTIONS NON COMPRISES DANS LE TOTAL DU DEVIS");
    expect(text).toContain("Option eclairage");
    expect(text).toContain("Total TVA");
    expect(text).toContain("TVA 10 %");
    expect(text).toContain("TVA 20 %");
    expect(xml).toContain("PAGE");
    expect(xml).toContain("NUMPAGES");
  });

  it("refuse un DOCX qui conserve encore un token de template", () => {
    const rendered = renderQuoteWordV2FilledDocx(readFileSync(templatePath), makeDocument());
    const entries = readZipArchive(rendered).map((entry) => {
      if (entry.name !== "word/document.xml") return entry;
      const xml = Buffer.from(entry.data).toString("utf8");
      const injected = xml.replace(
        "</w:body>",
        "<w:p><w:r><w:t>{{TOKEN_RESTANT}}</w:t></w:r></w:p></w:body>",
      );
      return cloneZipEntryWithData(entry, Buffer.from(injected, "utf8"));
    });
    const invalid = writeZipArchive(entries);

    expect(() => assertQuoteWordV2FilledDocx(invalid)).toThrow(
      "QUOTE_WORD_V2_UNRESOLVED_TOKENS:{{TOKEN_RESTANT}}",
    );
  });
});
