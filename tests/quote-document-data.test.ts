import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientRecordSchema } from "../src/lib/clients/domain";
import { commercialCaseSchema } from "../src/lib/commercial/domain";
import {
  buildQuoteDocumentData,
  buildQuoteWordV2ScalarData,
  type QuoteDocumentCompanyProfile,
} from "../src/lib/quotes/document-data";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const quoteId = "11111111-1111-4111-8111-111111111111";
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const sectionId = "44444444-4444-4444-8444-444444444444";
const mainLineId = "55555555-5555-4555-8555-555555555555";
const optionLineId = "66666666-6666-4666-8666-666666666666";
const optionId = "77777777-7777-4777-8777-777777777777";
const contactId = "88888888-8888-4888-8888-888888888888";

const company: QuoteDocumentCompanyProfile = {
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
};

function makeClient() {
  return clientRecordSchema.parse({
    id: clientId,
    type: "ENTREPRISE",
    companyName: "CLIENT TEST",
    firstName: "",
    lastName: "",
    addressLine1: "10 rue du Client",
    addressLine2: "Bâtiment A",
    postalCode: "69001",
    city: "Lyon",
    phone: "0400000000",
    email: "client@example.com",
    siret: "12345678901234",
    paymentTerms: "45 jours fin de mois",
    defaultVatRatePercent: 20,
    notes: "",
    contacts: [
      {
        id: contactId,
        firstName: "Alice",
        lastName: "Martin",
        role: "Architecte",
        phone: "0600000000",
        email: "alice@example.com",
        isPrimary: true,
      },
    ],
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-09-17T06:00:00.000Z",
    createdByName: "Nadia",
    updatedAt: "2026-09-17T06:00:00.000Z",
    updatedByName: "Nadia",
  });
}

function makeAffair() {
  return commercialCaseSchema.parse({
    id: affairId,
    sourceEntryId: null,
    clientId,
    primaryContactId: contactId,
    name: "Accueil siège social",
    clientName: "CLIENT TEST",
    siteLabel: "Siège Lyon",
    siteAddressOverride: {
      addressLine1: "25 rue du Chantier",
      addressLine2: "",
      postalCode: "69002",
      city: "Lyon",
    },
    contactName: "Alice Martin",
    contactPhone: "0600000000",
    contactEmail: "alice@example.com",
    description: null,
    nextAction: null,
    status: "CHIFFRAGE",
    reviewDate: "2026-09-20",
    expectedConfirmationDate: null,
    plannedInstallDate: null,
    confirmedAt: null,
    closedAt: null,
    closingReason: null,
    documents: [],
    createdAt: "2026-09-17T06:00:00.000Z",
    createdByName: "Nadia",
    updatedAt: "2026-09-17T06:00:00.000Z",
    updatedByName: "Nadia",
    history: [],
    quoteOwnerName: "Nadia",
    quoteDueDate: "2026-09-20",
    quoteSentAt: null,
    quoteNotes: "",
    provisionHours: { be: 0, workshop: 0, install: 0 },
  });
}

function makeQuote(withSchedule = true) {
  return parseNativeQuotesPayload({
    schemaVersion: 1,
    quotes: [
      {
        id: quoteId,
        commercialCaseId: affairId,
        variantName: "Base",
        version: 2,
        status: "DRAFT",
        pricingConfig: {
          adjustments: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              kind: "PERCENTAGE",
              label: "Marge PAPOT",
              active: true,
              applyToOptions: false,
              marginTreatment: "MARGED",
              percent: 10,
            },
          ],
          options: [
            {
              id: optionId,
              targetItemId: optionLineId,
              targetKind: "LINE",
              label: "Option habillage complémentaire",
              status: "PENDING",
            },
          ],
        },
        workSchedule: withSchedule
          ? {
              startDate: "2026-11-02",
              duration: "3 semaines",
              endDate: "2026-11-20",
            }
          : { startDate: null, duration: "", endDate: null },
        taxConfig: {
          defaultRatePercent: 20,
          lineOverrides: [{ lineId: optionLineId, ratePercent: 10 }],
        },
        model: {
          id: quoteId,
          clientId,
          subject: "Agencement accueil",
          issueDate: "2026-09-17",
          validityDays: 30,
          paymentTerms: "45 jours fin de mois",
          items: [
            {
              id: sectionId,
              kind: "SECTION",
              parentId: null,
              title: "Mobilier accueil",
            },
            {
              id: mainLineId,
              kind: "LINE",
              parentId: sectionId,
              description: "Banque d'accueil\navec retour à la ligne",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 10000,
              presentation: {
                richText: {
                  runs: [
                    {
                      text: "Banque d'accueil\navec retour à la ligne",
                      style: {
                        bold: false,
                        italic: false,
                        underline: false,
                        textColor: "#2563eb",
                        highlightColor: null,
                        fontSizePx: null,
                      },
                    },
                  ],
                },
                photos: [
                  {
                    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    fileName: "visible.jpg",
                    contentType: "image/jpeg",
                    sizeBytes: 1000,
                    sha256: "a".repeat(64),
                    storagePath: "quotes/visible.jpg",
                    clientVisible: true,
                    uploadedAt: "2026-09-17T06:00:00.000Z",
                    uploadedByName: "Nadia",
                  },
                  {
                    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    fileName: "interne.jpg",
                    contentType: "image/jpeg",
                    sizeBytes: 1000,
                    sha256: "b".repeat(64),
                    storagePath: "quotes/interne.jpg",
                    clientVisible: false,
                    uploadedAt: "2026-09-17T06:00:00.000Z",
                    uploadedByName: "Nadia",
                  },
                ],
              },
            },
            {
              id: optionLineId,
              kind: "LINE",
              parentId: sectionId,
              description: "Habillage complémentaire",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 5000,
            },
          ],
        },
        createdAt: "2026-09-17T06:00:00.000Z",
        createdByName: "Nadia",
        updatedAt: "2026-09-17T06:00:00.000Z",
        updatedByName: "Nadia",
      },
    ],
  }).quotes[0];
}

function buildDocument() {
  return buildQuoteDocumentData({
    quote: makeQuote(),
    client: makeClient(),
    commercialCase: makeAffair(),
    company,
    quoteNumber: "D202600123",
    clientCountry: "France",
  });
}

describe("quote document data", () => {
  it("prépare les données Word/PDF sans exposer les ajustements internes", () => {
    const document = buildDocument();

    expect(document.quote).toMatchObject({
      number: "D202600123",
      versionLabel: "Base V2",
      issueDate: "2026-09-17",
      validityDate: "2026-10-17",
      workStartDate: "2026-11-02",
      workDuration: "3 semaines",
      workEndDate: "2026-11-20",
    });
    expect(document.client.contactName).toBe("Alice Martin");
    expect(document.affair.siteAddressLine1).toBe("25 rue du Chantier");

    const mainLine = document.items.find((item) => item.id === mainLineId);
    expect(mainLine).toMatchObject({
      number: "1.1",
      scope: "MAIN",
      totalHtCents: 11000,
      vatRatePercent: 20,
      vatCents: 2200,
    });
    expect(mainLine?.richText?.runs[0].text).toContain("\n");
    expect(mainLine?.clientPhotos.map((photo) => photo.fileName)).toEqual(["visible.jpg"]);

    const optionLine = document.items.find((item) => item.id === optionLineId);
    expect(optionLine).toMatchObject({
      scope: "PENDING_OPTION",
      optionLabel: "Option habillage complémentaire",
      totalHtCents: 5000,
      vatRatePercent: 10,
      vatCents: 500,
    });

    expect(document.totals).toEqual({
      totalHtCents: 11000,
      totalVatCents: 2200,
      totalTtcCents: 13200,
      taxLines: [{ ratePercent: 20, baseHtCents: 11000, vatCents: 2200 }],
    });
    expect(document.pendingOptions).toEqual([
      {
        id: optionId,
        label: "Option habillage complémentaire",
        totalHtCents: 5000,
        totalVatCents: 500,
        totalTtcCents: 5500,
      },
    ]);
  });

  it("alimente exactement tous les tokens scalaires du modèle Word V2", () => {
    const manifestPath = new URL(
      "../docs/templates/PAPOT_Template_Devis_V2.manifest.json",
      import.meta.url,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      scalarTokens: string[];
    };
    const scalarData = buildQuoteWordV2ScalarData(buildDocument());

    expect(Object.keys(scalarData).sort()).toEqual([...manifest.scalarTokens].sort());
    expect(scalarData).toMatchObject({
      devis_numero: "D202600123",
      devis_date: "17/09/2026",
      devis_validite: "17/10/2026",
      travaux_debut: "02/11/2026",
      travaux_duree: "3 semaines",
      travaux_fin_limite: "20/11/2026",
      client_raison_sociale: "CLIENT TEST",
      client_contact_nom: "Alice Martin",
      affaire_nom: "Accueil siège social",
      chantier_ville: "Lyon",
      conditions_paiement: "45 jours fin de mois",
    });
    expect(scalarData.total_ht).toContain("110,00");
    expect(scalarData.total_ttc).toContain("132,00");
    expect(scalarData.net_a_payer).toBe(scalarData.total_ttc);
  });

  it("bloque la préparation du document tant que les trois données travaux ne sont pas complètes", () => {
    expect(() =>
      buildQuoteDocumentData({
        quote: makeQuote(false),
        client: makeClient(),
        commercialCase: makeAffair(),
        company,
        quoteNumber: "D202600123",
      }),
    ).toThrow("QUOTE_DOCUMENT_WORK_START_REQUIRED");
  });

  it("bloque un document construit avec une mauvaise fiche client", () => {
    const wrongClient = clientRecordSchema.parse({
      ...makeClient(),
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(() =>
      buildQuoteDocumentData({
        quote: makeQuote(),
        client: wrongClient,
        commercialCase: makeAffair(),
        company,
        quoteNumber: "D202600123",
      }),
    ).toThrow("QUOTE_DOCUMENT_CLIENT_MISMATCH");
  });
});
