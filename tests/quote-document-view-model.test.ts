import { describe, expect, it } from "vitest";
import { clientRecordSchema } from "../src/lib/clients/domain";
import { commercialCaseSchema } from "../src/lib/commercial/domain";
import { buildQuoteDocumentViewModel } from "../src/lib/quotes/document-view-model";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const quoteId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const mainSectionId = "44444444-4444-4444-8444-444444444444";
const mainLineId = "55555555-5555-4555-8555-555555555555";
const secondLineId = "66666666-6666-4666-8666-666666666666";
const optionSectionId = "77777777-7777-4777-8777-777777777777";
const optionLineId = "88888888-8888-4888-8888-888888888888";
const visiblePhotoId = "99999999-9999-4999-8999-999999999999";
const hiddenPhotoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const optionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const adjustmentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const contactId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeClient() {
  return clientRecordSchema.parse({
    id: clientId,
    type: "ENTREPRISE",
    companyName: "Client Démonstration",
    firstName: "",
    lastName: "",
    addressLine1: "12 rue du Test",
    addressLine2: "",
    postalCode: "42300",
    city: "Roanne",
    phone: "0477000000",
    email: "client@example.fr",
    siret: "12345678901234",
    paymentTerms: "30 jours",
    defaultVatRatePercent: 20,
    notes: "Note fiche client strictement interne",
    contacts: [
      {
        id: contactId,
        firstName: "Alice",
        lastName: "Martin",
        role: "Architecte",
        phone: "0477000001",
        email: "alice@example.fr",
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

function makeCommercialCase() {
  return commercialCaseSchema.parse({
    id: caseId,
    sourceEntryId: null,
    clientId,
    primaryContactId: contactId,
    name: "Accueil mairie",
    clientName: "Client Démonstration",
    siteLabel: "Mairie de Roanne",
    siteAddressOverride: {
      addressLine1: "1 place de l'Hôtel de Ville",
      addressLine2: "",
      postalCode: "42300",
      city: "Roanne",
    },
    contactName: "Contact historique",
    contactPhone: null,
    contactEmail: null,
    description: null,
    nextAction: null,
    status: "CHIFFRAGE",
    reviewDate: null,
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
    quoteOwnerName: "Lucien",
    quoteDueDate: "2026-09-20",
    quoteSentAt: null,
    quoteNotes: "Note commerciale interne",
    provisionHours: { be: 0, workshop: 0, install: 0 },
  });
}

function makeQuote() {
  return parseNativeQuotesPayload({
    schemaVersion: 1,
    quotes: [
      {
        id: quoteId,
        commercialCaseId: caseId,
        variantName: "Base",
        version: 2,
        status: "DRAFT",
        sentAt: null,
        followUpDate: null,
        internalNotes: "Ne jamais montrer cette note au client",
        pricingConfig: {
          adjustments: [
            {
              id: adjustmentId,
              label: "Commission architecte interne",
              kind: "PERCENTAGE",
              percent: 10,
              active: true,
              applyToOptions: true,
              marginTreatment: "MARGED",
            },
          ],
          options: [
            {
              id: optionId,
              targetItemId: optionSectionId,
              targetKind: "SECTION",
              label: "Option mobilier complémentaire",
              status: "RETAINED",
            },
          ],
        },
        workSchedule: {
          startDate: "2026-10-05",
          duration: "3 semaines",
          endDate: "2026-10-23",
        },
        taxConfig: {
          defaultRatePercent: 20,
          lineOverrides: [{ lineId: secondLineId, ratePercent: 10 }],
        },
        model: {
          id: quoteId,
          clientId,
          subject: "Agencement de l'accueil",
          issueDate: "2026-09-17",
          validityDays: 30,
          paymentTerms: "45 jours fin de mois",
          items: [
            {
              id: mainSectionId,
              kind: "SECTION",
              parentId: null,
              title: "Banque d'accueil",
            },
            {
              id: mainLineId,
              kind: "LINE",
              parentId: mainSectionId,
              description: "Habillage\navec retour",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 10000,
              presentation: {
                richText: {
                  runs: [
                    {
                      text: "Habillage\navec retour",
                      style: {
                        bold: true,
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
                    id: visiblePhotoId,
                    fileName: "client-visible.jpg",
                    contentType: "image/jpeg",
                    sizeBytes: 1200,
                    sha256: "a".repeat(64),
                    storagePath: "quotes/client-visible.jpg",
                    clientVisible: true,
                    uploadedAt: "2026-09-17T06:30:00.000Z",
                    uploadedByName: "Lucien",
                  },
                  {
                    id: hiddenPhotoId,
                    fileName: "interne.jpg",
                    contentType: "image/jpeg",
                    sizeBytes: 900,
                    sha256: "b".repeat(64),
                    storagePath: "quotes/interne.jpg",
                    clientVisible: false,
                    uploadedAt: "2026-09-17T06:30:00.000Z",
                    uploadedByName: "Lucien",
                  },
                ],
              },
            },
            {
              id: secondLineId,
              kind: "LINE",
              parentId: mainSectionId,
              description: "Meuble bas",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 10000,
            },
            {
              id: optionSectionId,
              kind: "SECTION",
              parentId: null,
              title: "Mobilier complémentaire",
            },
            {
              id: optionLineId,
              kind: "LINE",
              parentId: optionSectionId,
              description: "Caisson optionnel",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 5000,
            },
          ],
        },
        createdAt: "2026-09-17T06:00:00.000Z",
        createdByName: "Lucien",
        updatedAt: "2026-09-17T06:30:00.000Z",
        updatedByName: "Lucien",
      },
    ],
  }).quotes[0];
}

function build(quoteNumber: string | null = "D-2026-0042") {
  return buildQuoteDocumentViewModel({
    quote: makeQuote(),
    client: makeClient(),
    commercialCase: makeCommercialCase(),
    quoteNumber,
  });
}

describe("quote document view model", () => {
  it("prépare l'en-tête client et affaire à partir des snapshots métier", () => {
    const document = build();

    expect(document.quote).toMatchObject({
      number: "D-2026-0042",
      subject: "Agencement de l'accueil",
      variantName: "Base",
      version: 2,
      issueDate: "2026-09-17",
      validityDate: "2026-10-17",
      paymentTerms: "45 jours fin de mois",
      workStartDate: "2026-10-05",
      workDuration: "3 semaines",
      workEndDate: "2026-10-23",
    });
    expect(document.client).toMatchObject({
      displayName: "Client Démonstration",
      contactName: "Alice Martin",
      city: "Roanne",
      identifierLabel: "SIRET",
      identifier: "12345678901234",
    });
    expect(document.affair).toMatchObject({
      name: "Accueil mairie",
      siteLabel: "Mairie de Roanne",
      siteCity: "Roanne",
    });
    expect(document.readyForPdf).toBe(true);
  });

  it("applique les ajustements mais laisse toute option hors du total principal", () => {
    const document = build();

    expect(document.main.totalHtCents).toBe(22000);
    expect(document.options).toHaveLength(1);
    expect(document.options[0]).toMatchObject({
      label: "Option mobilier complémentaire",
      status: "RETAINED",
      totalHtCents: 5500,
    });
    expect(document.main.rows.some((row) => row.sourceItemId === optionLineId)).toBe(false);
    expect(document.options[0].rows.some((row) => row.sourceItemId === optionLineId)).toBe(true);

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("Commission architecte interne");
    expect(serialized).not.toContain("Ne jamais montrer cette note au client");
    expect(serialized).not.toContain("Note fiche client strictement interne");
    expect(serialized).not.toContain("Note commerciale interne");
  });

  it("calcule la TVA effective ligne par ligne puis l'agrège par taux", () => {
    const document = build();

    expect(document.main.vatLines).toEqual([
      { ratePercent: 10, baseHtCents: 11000, vatAmountCents: 1100 },
      { ratePercent: 20, baseHtCents: 11000, vatAmountCents: 2200 },
    ]);
    expect(document.main.totalVatCents).toBe(3300);
    expect(document.main.totalTtcCents).toBe(25300);
    expect(document.options[0].vatLines).toEqual([
      { ratePercent: 20, baseHtCents: 5500, vatAmountCents: 1100 },
    ]);
    expect(document.options[0].totalTtcCents).toBe(6600);
  });

  it("conserve le texte riche, les retours à la ligne et seulement les photos client", () => {
    const document = build();
    const line = document.main.rows.find(
      (row) => row.kind === "LINE" && row.sourceItemId === mainLineId,
    );
    expect(line?.kind).toBe("LINE");
    if (!line || line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    expect(line.text.plainText).toBe("Habillage\navec retour");
    expect(line.text.richText?.runs[0].text).toBe("Habillage\navec retour");

    const photos = document.main.rows.filter((row) => row.kind === "PHOTO");
    expect(photos).toHaveLength(1);
    expect(photos[0].sourceItemId).toBe(visiblePhotoId);
    expect(JSON.stringify(document)).not.toContain("interne.jpg");
  });

  it("reste non prêt pour PDF tant qu'aucun numéro de devis réel n'est fourni", () => {
    const document = build(null);
    expect(document.quote.number).toBeNull();
    expect(document.missingRequiredFields).toContain("quoteNumber");
    expect(document.readyForPdf).toBe(false);
  });

  it("refuse de mélanger un devis avec un autre client ou une autre affaire", () => {
    const client = makeClient();
    expect(() =>
      buildQuoteDocumentViewModel({
        quote: makeQuote(),
        client: { ...client, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
        commercialCase: makeCommercialCase(),
      }),
    ).toThrow("QUOTE_DOCUMENT_CLIENT_MISMATCH");

    expect(() =>
      buildQuoteDocumentViewModel({
        quote: makeQuote(),
        client,
        commercialCase: {
          ...makeCommercialCase(),
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        },
      }),
    ).toThrow("QUOTE_DOCUMENT_CASE_MISMATCH");
  });
});
