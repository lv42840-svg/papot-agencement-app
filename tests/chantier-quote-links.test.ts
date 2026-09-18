import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload, type CommercialCase } from "../src/lib/commercial/domain";
import {
  chantierQuoteLineDisplay,
  resolveRetainedChantierQuoteLine,
  retainedChantierQuoteLines,
  retainedChantierQuotes,
} from "../src/lib/chantiers/quote-links";
import {
  nativeQuoteRecordSchema,
  type NativeQuoteRecord,
  type NativeQuotesPayload,
} from "../src/lib/quotes/store";

const affairId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const retainedQuoteId = "33333333-3333-4333-8333-333333333333";
const otherQuoteId = "44444444-4444-4444-8444-444444444444";
const retainedLineId = "55555555-5555-4555-8555-555555555555";

function quote(id: string, lineId: string, number: string): NativeQuoteRecord {
  return nativeQuoteRecordSchema.parse({
    id,
    commercialCaseId: affairId,
    variantName: "Base",
    version: 1,
    status: "SENT",
    sentAt: "2026-09-18T05:00:00.000Z",
    followUpDate: "2026-09-30",
    finalPdf: {
      quoteNumber: number,
      variantName: "Base",
      version: 1,
      commercialDocumentId: crypto.randomUUID(),
      fileName: `${number}.pdf`,
      storagePath: `Commercial/${number}.pdf`,
      sizeBytes: 100,
      sha256: "a".repeat(64),
      archivedAt: "2026-09-18T05:00:00.000Z",
      archivedByName: "Lucien",
    },
    model: {
      id,
      clientId,
      subject: "Agencement boutique",
      issueDate: "2026-09-18",
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
      items: [
        {
          id: lineId,
          kind: "LINE",
          parentId: null,
          description: id === retainedQuoteId ? "Banque accueil" : "Variante non retenue",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          unitPriceCents: 100_000,
        },
      ],
    },
    createdAt: "2026-09-18T04:00:00.000Z",
    createdByName: "Lucien",
    updatedAt: "2026-09-18T05:00:00.000Z",
    updatedByName: "Lucien",
  });
}

function affair(): CommercialCase {
  const now = "2026-09-18T05:00:00.000Z";
  return {
    ...createInitialCommercialPayload().cases[0],
    id: affairId,
    sourceEntryId: null,
    clientId,
    primaryContactId: null,
    name: "Boutique",
    clientName: "Client",
    siteLabel: "Roanne",
    siteAddressOverride: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    description: null,
    nextAction: null,
    status: "CONFIRMED",
    reviewDate: null,
    expectedConfirmationDate: null,
    plannedInstallDate: "2026-11-10",
    confirmedAt: now,
    retainedQuoteIds: [retainedQuoteId],
    closedAt: null,
    closingReason: null,
    documents: [],
    createdAt: now,
    createdByName: "Lucien",
    updatedAt: now,
    updatedByName: "Lucien",
    history: [],
    quoteOwnerName: null,
    quoteDueDate: null,
    quoteSentAt: now,
    quoteNotes: "",
    provisionHours: { be: 0, workshop: 0, install: 0 },
  } as CommercialCase;
}

describe("chantier native quote links", () => {
  const retained = quote(retainedQuoteId, retainedLineId, "D-2026-0001");
  const other = quote(otherQuoteId, crypto.randomUUID(), "D-2026-0002");
  const payload: NativeQuotesPayload = { schemaVersion: 1, quotes: [retained, other] };

  it("exposes lines only from retained quotes", () => {
    const groups = retainedChantierQuotes(affair(), payload);
    const lines = retainedChantierQuoteLines(affair(), payload);

    expect(groups).toHaveLength(1);
    expect(groups[0].quote.id).toBe(retainedQuoteId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quoteId: retainedQuoteId,
      quoteLineId: retainedLineId,
      quoteNumber: "D-2026-0001",
      description: "Banque accueil",
    });
  });

  it("resolves a retained line by durable quote and line ids", () => {
    const line = resolveRetainedChantierQuoteLine(
      affair(),
      payload,
      retainedQuoteId,
      retainedLineId,
    );
    expect(chantierQuoteLineDisplay(line)).toBe("D-2026-0001 · Banque accueil");
  });

  it("rejects a line from a non-retained quote", () => {
    expect(() =>
      resolveRetainedChantierQuoteLine(affair(), payload, otherQuoteId, other.model.items[0].id),
    ).toThrow("CHANTIER_QUOTE_LINE_INVALID");
  });
});
