import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import type { QuoteDocumentData } from "../src/lib/quotes/document-data";
import { renderQuoteWordV2Body } from "../src/lib/quotes/word-v2-renderer";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);

function makeDocument(): QuoteDocumentData {
  return {
    quote: {
      id: "11111111-1111-4111-8111-111111111111",
      number: "D202600123",
      variantName: "Base",
      version: 1,
      versionLabel: "Base V1",
      issueDate: "2026-09-17",
      validityDate: "2026-10-17",
      subject: "Agencement accueil",
      paymentTerms: "45 jours fin de mois",
      workStartDate: "2026-11-02",
      workDuration: "3 semaines",
      workEndDate: "2026-11-20",
    },
    company: {
      name: "PAPOT AGENCEMENT",
      addressLine1: "196 chemin de la Petite Beluze",
      postalCode: "42153",
      city: "Riorges",
      legalForm: "SAS",
      capital: "2 000 €",
      siret: "10815969000016",
      rcs: "108 159 690 RCS Roanne",
      ape: "4332A",
      vatNumber: "FR17108159690",
      phone: "04 77 71 35 56",
      email: "contact@papot.eu",
      insurerName: "AXA",
      insurerAddress: "Roanne",
      insuranceCoverage: "France métropolitaine",
      bankName: "Banque test",
      bankAccountHolder: "PAPOT AGENCEMENT",
      iban: "FR7612345678901234567890123",
      bic: "TESTFRPP",
      paymentMethods: "Virement",
      chequePayee: "PAPOT AGENCEMENT",
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
      identifier: "12345678901234",
    },
    affair: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Accueil siège social",
      siteLabel: "Siège Lyon",
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
        kind: "SUBSECTION",
        number: "1.1",
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "Banque principale",
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
        id: "66666666-6666-4666-8666-666666666666",
        kind: "LINE",
        number: "1.1.1",
        parentId: "55555555-5555-4555-8555-555555555555",
        text: "Banque d'accueil\navec retour à la ligne",
        richText: {
          runs: [
            {
              text: "Banque d'accueil\n",
              style: {
                bold: true,
                italic: false,
                underline: true,
                textColor: "#2563eb",
                highlightColor: "#fff2a8",
                fontSizePx: 16,
              },
            },
            {
              text: "avec retour à la ligne",
              style: {
                bold: false,
                italic: true,
                underline: false,
                textColor: null,
                highlightColor: null,
                fontSizePx: null,
              },
            },
          ],
        },
        clientPhotos: [],
        scope: "MAIN",
        optionId: null,
        optionLabel: null,
        optionStatus: null,
        quantity: 2.5,
        unit: "u",
        unitPriceHt: 1234.5,
        totalHtCents: 308625,
        vatRatePercent: 20,
        vatCents: 61725,
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        kind: "COMMENT",
        number: "1.1.2",
        parentId: "55555555-5555-4555-8555-555555555555",
        text: "Pose comprise dans notre prestation",
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
        id: "88888888-8888-4888-8888-888888888888",
        kind: "LINE",
        number: "1.2",
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "OPTION À NE PAS AFFICHER DANS LE CORPS",
        richText: null,
        clientPhotos: [],
        scope: "PENDING_OPTION",
        optionId: "99999999-9999-4999-8999-999999999999",
        optionLabel: "Option habillage",
        optionStatus: "PENDING",
        quantity: 1,
        unit: "u",
        unitPriceHt: 500,
        totalHtCents: 50000,
        vatRatePercent: 10,
        vatCents: 5000,
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "LINE",
        number: "1.3",
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "Option déjà retenue",
        richText: null,
        clientPhotos: [],
        scope: "RETAINED_OPTION",
        optionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        optionLabel: "Option retenue",
        optionStatus: "RETAINED",
        quantity: 1,
        unit: "u",
        unitPriceHt: 300,
        totalHtCents: 30000,
        vatRatePercent: 20,
        vatCents: 6000,
      },
    ],
    totals: {
      totalHtCents: 338625,
      totalVatCents: 67725,
      totalTtcCents: 406350,
      taxLines: [{ ratePercent: 20, baseHtCents: 338625, vatCents: 67725 }],
    },
    pendingOptions: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        label: "Option habillage",
        totalHtCents: 50000,
        totalVatCents: 5000,
        totalTtcCents: 55000,
      },
    ],
  };
}

function documentXml(docx: Uint8Array): string {
  const entry = readZipArchive(docx).find((item) => item.name === "word/document.xml");
  if (!entry) throw new Error("TEST_DOCUMENT_XML_MISSING");
  return Buffer.from(entry.data).toString("utf8");
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

function rowContaining(xml: string, text: string): string {
  const rows = Array.from(xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g), (match) => match[0]);
  const row = rows.find((candidate) => xmlText(candidate).includes(text));
  if (!row) throw new Error(`TEST_ROW_MISSING:${text}`);
  return row;
}

function rowCells(row: string): string[] {
  return Array.from(row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g), (match) => xmlText(match[0]));
}

describe("quote Word V2 dynamic body", () => {
  it("remplace l’ancre par les titres, ouvrages et commentaires dans les 6 colonnes réelles", () => {
    const rendered = renderQuoteWordV2Body(readFileSync(templatePath), makeDocument());
    const xml = documentXml(rendered);

    expect(xml).not.toContain("PAPOT_QUOTE_BODY");
    expect(xmlText(xml)).toContain("Mobilier accueil");
    expect(xmlText(xml)).toContain("Banque principale");
    expect(xmlText(xml)).toContain("Pose comprise dans notre prestation");
    expect(xmlText(xml)).toContain("Option déjà retenue");
    expect(xmlText(xml)).not.toContain("OPTION À NE PAS AFFICHER DANS LE CORPS");

    const lineRow = rowContaining(xml, "Banque d'accueil");
    const cells = rowCells(lineRow);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toBe("1.1.1");
    expect(cells[1]).toBe("Banque d'accueil\navec retour à la ligne");
    expect(cells[2]).toBe("2,5");
    expect(cells[3]).toContain("1");
    expect(cells[3]).toContain("234,50");
    expect(cells[4]).toBe("20 %");
    expect(cells[5]).toContain("3");
    expect(cells[5]).toContain("086,25");
  });

  it("convertit les retours et le style riche en vrais éléments Word", () => {
    const xml = documentXml(renderQuoteWordV2Body(readFileSync(templatePath), makeDocument()));
    const lineRow = rowContaining(xml, "Banque d'accueil");

    expect(lineRow).toContain("<w:br/>");
    expect(lineRow).toContain("<w:b/>");
    expect(lineRow).toContain('<w:u w:val="single"/>');
    expect(lineRow).toContain('<w:color w:val="2563EB"/>');
    expect(lineRow).toContain('w:fill="FFF2A8"');
    expect(lineRow).toContain("<w:i/>");
  });

  it("conserve les autres ancres dynamiques et le DOCX reste relisible", () => {
    const rendered = renderQuoteWordV2Body(readFileSync(templatePath), makeDocument());
    const xml = documentXml(rendered);

    expect(Buffer.from(rendered).subarray(0, 2).toString("ascii")).toBe("PK");
    expect(xml).toContain("PAPOT_OPTIONS_BLOCK");
    expect(xml).toContain("PAPOT_VAT_SUMMARY");
    expect(xml).toContain("PAPOT_VAT_LINES_ANCHOR");
  });
});
