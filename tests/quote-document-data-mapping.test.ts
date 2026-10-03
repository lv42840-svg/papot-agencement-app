import { describe, expect, it, vi } from "vitest";
import { clientRecordSchema, type ClientsPayload } from "../src/lib/clients/domain";
import { commercialCaseSchema, type CommercialPayload } from "../src/lib/commercial/domain";
import { companyProfileSchema } from "../src/lib/company-profile/domain";
import {
  buildQuoteDocumentDataFromPayloads,
  loadQuoteDocumentDataFromSources,
  type QuoteDocumentDataPayloads,
} from "../src/lib/quotes/document-data-mapping";
import { buildQuoteWordV2ScalarData } from "../src/lib/quotes/document-data";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const quoteId = "11111111-1111-4111-8111-111111111111";
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const contactId = "44444444-4444-4444-8444-444444444444";
const otherClientId = "55555555-5555-4555-8555-555555555555";

function makeQuotes() {
  return parseNativeQuotesPayload({
    schemaVersion: 1,
    quotes: [
      {
        id: quoteId,
        commercialCaseId: affairId,
        variantName: "Variante accueil",
        version: 3,
        status: "DRAFT",
        pricingConfig: { adjustments: [], options: [] },
        workSchedule: {
          startDate: "2026-10-05",
          duration: "2 semaines",
          endDate: "2026-10-16",
        },
        taxConfig: { defaultRatePercent: 20, lineOverrides: [] },
        model: {
          id: quoteId,
          clientId,
          subject: "Agencement accueil",
          issueDate: "2026-09-17",
          validityDays: 30,
          paymentTerms: "45 jours fin de mois",
          items: [],
        },
        createdAt: "2026-09-17T06:00:00.000Z",
        createdByName: "Nadia",
        updatedAt: "2026-09-17T06:00:00.000Z",
        updatedByName: "Nadia",
      },
    ],
  });
}

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

function makeCommercialCase(clientLink = clientId) {
  return commercialCaseSchema.parse({
    id: affairId,
    sourceEntryId: null,
    clientId: clientLink,
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
  });
}

function makePayloads(): QuoteDocumentDataPayloads {
  const clients: ClientsPayload = { schemaVersion: 1, clients: [makeClient()] };
  const commercial: CommercialPayload = {
    schemaVersion: 2,
    clients: [],
    cases: [makeCommercialCase()],
  };
  return {
    quotes: makeQuotes(),
    clients,
    commercial,
    companyProfile: companyProfileSchema.parse({
      name: "PAPOT AGENCEMENT",
      city: "Riorges",
      paymentMethods: "Virement",
    }),
  };
}

describe("quote document data mapping", () => {
  it("résout les vraies sources liées puis alimente les données Word sans inventer de pays", () => {
    const document = buildQuoteDocumentDataFromPayloads(
      { quoteId, quoteNumber: "D-2026-0042" },
      makePayloads(),
    );
    const scalars = buildQuoteWordV2ScalarData(document);

    expect(document.quote).toMatchObject({
      id: quoteId,
      number: "D-2026-0042",
      variantName: "Variante accueil",
      version: 3,
      versionLabel: "Variante accueil V3",
    });
    expect(document.company.name).toBe("PAPOT AGENCEMENT");
    expect(document.client).toMatchObject({
      id: clientId,
      displayName: "CLIENT TEST",
      contactName: "Alice Martin",
      country: "",
      identifierLabel: "SIRET",
      identifier: "12345678901234",
    });
    expect(document.affair).toMatchObject({
      id: affairId,
      name: "Accueil siège social",
      siteAddressLine1: "25 rue du Chantier",
      sitePostalCode: "69002",
      siteCity: "Lyon",
    });
    expect(scalars).toMatchObject({
      societe_nom: "PAPOT AGENCEMENT",
      devis_numero: "D-2026-0042",
      client_raison_sociale: "CLIENT TEST",
      client_pays: "",
      affaire_nom: "Accueil siège social",
      chantier_ville: "Lyon",
      conditions_paiement: "45 jours fin de mois",
      methodes_paiement: "Virement",
    });
  });

  it("refuse les liens métier absents ou incohérents au lieu de choisir une autre fiche", () => {
    const payloads = makePayloads();

    expect(() =>
      buildQuoteDocumentDataFromPayloads(
        { quoteId: otherClientId, quoteNumber: "D-2026-0042" },
        payloads,
      ),
    ).toThrow("QUOTE_DOCUMENT_QUOTE_NOT_FOUND");

    expect(() =>
      buildQuoteDocumentDataFromPayloads(
        { quoteId, quoteNumber: "D-2026-0042" },
        { ...payloads, clients: { ...payloads.clients, clients: [] } },
      ),
    ).toThrow("QUOTE_DOCUMENT_CLIENT_NOT_FOUND");

    expect(() =>
      buildQuoteDocumentDataFromPayloads(
        { quoteId, quoteNumber: "D-2026-0042" },
        { ...payloads, commercial: { ...payloads.commercial, cases: [] } },
      ),
    ).toThrow("QUOTE_DOCUMENT_AFFAIR_NOT_FOUND");

    expect(() =>
      buildQuoteDocumentDataFromPayloads(
        { quoteId, quoteNumber: "D-2026-0042" },
        {
          ...payloads,
          commercial: {
            ...payloads.commercial,
            cases: [makeCommercialCase(otherClientId)],
          },
        },
      ),
    ).toThrow("QUOTE_DOCUMENT_AFFAIR_CLIENT_MISMATCH");
  });

  it("charge une fois chaque dépôt avant de construire le document", async () => {
    const payloads = makePayloads();
    const sources = {
      quotes: { load: vi.fn(async () => payloads.quotes) },
      clients: { load: vi.fn(async () => payloads.clients) },
      commercial: { load: vi.fn(async () => payloads.commercial) },
      companyProfile: { load: vi.fn(async () => payloads.companyProfile) },
    };

    const document = await loadQuoteDocumentDataFromSources(
      { quoteId, quoteNumber: "D-2026-0042", clientCountry: "France" },
      sources,
    );

    expect(document.client.country).toBe("France");
    expect(sources.quotes.load).toHaveBeenCalledTimes(1);
    expect(sources.clients.load).toHaveBeenCalledTimes(1);
    expect(sources.commercial.load).toHaveBeenCalledTimes(1);
    expect(sources.companyProfile.load).toHaveBeenCalledTimes(1);
  });
});
