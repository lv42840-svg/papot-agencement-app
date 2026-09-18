import { describe, expect, it } from "vitest";
import type { CommercialCase } from "../src/lib/commercial/domain";
import { createInitialChantiersPayload } from "../src/lib/chantiers/domain";
import { launchChantierFromCommercial } from "../src/lib/chantiers/mutations";
import { calculateChantierProfitability } from "../src/lib/chantiers/profitability";
import { nativeQuoteRecordSchema, type NativeQuoteRecord } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const quoteAId = "44444444-4444-4444-8444-444444444444";
const quoteBId = "55555555-5555-4555-8555-555555555555";

function affair(retainedQuoteIds: string[] = [quoteAId, quoteBId]): CommercialCase {
  const now = "2026-09-18T08:00:00.000Z";
  return {
    id: affairId,
    sourceEntryId: null,
    clientId,
    primaryContactId: null,
    name: "Boutique test",
    clientName: "Client test",
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
    retainedQuoteIds,
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
  };
}

function quote({
  id,
  saleCents,
  costCents,
  quoteKind = "STANDARD",
  adjustmentPercent = 0,
}: {
  id: string;
  saleCents: number;
  costCents: number | null;
  quoteKind?: "STANDARD" | "TS";
  adjustmentPercent?: number;
}): NativeQuoteRecord {
  return nativeQuoteRecordSchema.parse({
    id,
    commercialCaseId: affairId,
    quoteKind,
    variantName: quoteKind === "TS" ? "Complément 1" : "Base",
    version: 1,
    status: "ACCEPTED",
    sentAt: "2026-09-18T08:00:00.000Z",
    followUpDate: null,
    finalPdf: {
      quoteNumber: id === quoteAId ? "D-2026-0001" : "D-2026-0002",
      variantName: quoteKind === "TS" ? "Complément 1" : "Base",
      version: 1,
      commercialDocumentId: crypto.randomUUID(),
      fileName: "devis.pdf",
      storagePath: "Commercial/devis.pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
      archivedAt: "2026-09-18T08:00:00.000Z",
      archivedByName: "Lucien",
    },
    pricingConfig: {
      adjustments:
        adjustmentPercent > 0
          ? [
              {
                id: crypto.randomUUID(),
                kind: "PERCENTAGE",
                label: "Marge complémentaire",
                active: true,
                applyToOptions: true,
                marginTreatment: "MARGED",
                percent: adjustmentPercent,
              },
            ]
          : [],
      options: [],
    },
    model: {
      id,
      clientId,
      subject: quoteKind === "TS" ? "Travaux supplémentaires" : "Agencement",
      issueDate: "2026-09-18",
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
      items: [
        {
          id: crypto.randomUUID(),
          kind: "LINE",
          parentId: null,
          description: "Ouvrage",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          unitPriceCents: saleCents,
          components:
            costCents === null
              ? []
              : [
                  {
                    id: crypto.randomUUID(),
                    description: "Composant",
                    unit: "u",
                    quantity: 1,
                    quantityFormula: null,
                    costPriceCents: costCents,
                    unitPriceCents: saleCents,
                  },
                ],
        },
      ],
    },
    createdAt: "2026-09-18T07:00:00.000Z",
    createdByName: "Lucien",
    updatedAt: "2026-09-18T08:00:00.000Z",
    updatedByName: "Lucien",
  });
}

function chantier(commercialCase: CommercialCase) {
  const launched = launchChantierFromCommercial(
    createInitialChantiersPayload(),
    commercialCase,
    {
      commercialCaseId: commercialCase.id,
      quoteMissingDeclared: commercialCase.retainedQuoteIds.length === 0,
      signedQuoteMissingDeclared: true,
      costingMissingDeclared: true,
      be: 10,
      workshop: 20,
      install: 30,
    },
    actor,
    new Date("2026-09-18T09:00:00.000Z"),
  ).payload.chantiers[0];

  return {
    ...launched,
    actualHours: { be: 4, workshop: 12, install: 18 },
  };
}

describe("chantier global profitability", () => {
  it("sums only retained native quotes and includes accepted TS in sold and planned margin", () => {
    const commercialCase = affair();
    const item = chantier(commercialCase);
    const result = calculateChantierProfitability(item, commercialCase, {
      schemaVersion: 1,
      quotes: [
        quote({ id: quoteAId, saleCents: 100_000, costCents: 60_000, adjustmentPercent: 10 }),
        quote({ id: quoteBId, saleCents: 50_000, costCents: 30_000, quoteKind: "TS" }),
        quote({
          id: "66666666-6666-4666-8666-666666666666",
          saleCents: 999_999,
          costCents: 1,
        }),
      ],
    });

    expect(result.soldCents).toBe(160_000);
    expect(result.plannedCostCents).toBe(90_000);
    expect(result.plannedMarginCents).toBe(70_000);
    expect(result.plannedMarginPercent).toBeCloseTo(77.777777, 5);
    expect(result.retainedQuotes).toHaveLength(2);
    expect(result.retainedQuotes[1].quoteKind).toBe("TS");
    expect(result.plannedHours).toEqual({ be: 10, workshop: 20, install: 30, total: 60 });
    expect(result.actualHours).toEqual({ be: 4, workshop: 12, install: 18, total: 34 });
  });

  it("leaves planned cost and margin empty when one retained quote has incomplete costing", () => {
    const commercialCase = affair();
    const result = calculateChantierProfitability(chantier(commercialCase), commercialCase, {
      schemaVersion: 1,
      quotes: [
        quote({ id: quoteAId, saleCents: 100_000, costCents: 60_000 }),
        quote({ id: quoteBId, saleCents: 50_000, costCents: null, quoteKind: "TS" }),
      ],
    });

    expect(result.soldCents).toBe(150_000);
    expect(result.plannedCostCents).toBeNull();
    expect(result.plannedMarginCents).toBeNull();
    expect(result.plannedMarginPercent).toBeNull();
  });

  it("does not invent zero sold when the chantier has no retained quote", () => {
    const commercialCase = affair([]);
    const result = calculateChantierProfitability(chantier(commercialCase), commercialCase, {
      schemaVersion: 1,
      quotes: [],
    });

    expect(result.soldCents).toBeNull();
    expect(result.plannedCostCents).toBeNull();
    expect(result.plannedMarginCents).toBeNull();
  });

  it("invalidates sold when a retained quote id cannot be resolved", () => {
    const commercialCase = affair();
    const result = calculateChantierProfitability(chantier(commercialCase), commercialCase, {
      schemaVersion: 1,
      quotes: [quote({ id: quoteAId, saleCents: 100_000, costCents: 60_000 })],
    });

    expect(result.soldCents).toBeNull();
    expect(result.missingRetainedQuoteIds).toEqual([quoteBId]);
  });

  it("calculates real global margin only when both real cost sources are available", () => {
    const commercialCase = affair([quoteAId]);
    const item = chantier(commercialCase);
    const quotes = {
      schemaVersion: 1 as const,
      quotes: [quote({ id: quoteAId, saleCents: 100_000, costCents: 60_000 })],
    };

    const unavailable = calculateChantierProfitability(item, commercialCase, quotes);
    expect(unavailable.actualMarginCents).toBeNull();
    expect(unavailable.actualTotalCostCents).toBeNull();

    const complete = calculateChantierProfitability(item, commercialCase, quotes, {
      laborCostCents: 70_000,
      purchaseCostCents: 50_000,
    });
    expect(complete.actualTotalCostCents).toBe(120_000);
    expect(complete.actualMarginCents).toBe(-20_000);
    expect(complete.actualMarginPercent).toBeCloseTo(-16.666666, 5);
  });
});
