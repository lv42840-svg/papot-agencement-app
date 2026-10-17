import { describe, expect, it } from "vitest";
import type { CommercialCase } from "../src/lib/commercial/domain";
import { calculateDashboardSoldSummary } from "../src/lib/dashboard/sold-summary";
import { nativeQuoteRecordSchema } from "../src/lib/quotes/store";

const caseId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";

function affair(confirmedAt: string, retainedQuoteIds = [quoteId]): CommercialCase {
  return { id: caseId, status: "CONFIRMED", confirmedAt, retainedQuoteIds } as CommercialCase;
}

function quote() {
  return nativeQuoteRecordSchema.parse({
    id: quoteId,
    commercialCaseId: caseId,
    quoteKind: "STANDARD",
    variantName: "Base",
    version: 1,
    status: "ACCEPTED",
    model: {
      id: quoteId,
      clientId,
      subject: "Agencement",
      issueDate: "2026-10-01",
      validityDays: 30,
      paymentTerms: "45 jours",
      items: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          kind: "LINE",
          parentId: null,
          description: "Agencement",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          unitPriceCents: 100000,
          components: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              description: "Matériaux",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              costPriceCents: 60000,
              unitPriceCents: 100000,
            },
          ],
        },
      ],
    },
    createdAt: "2026-10-10T10:00:00Z",
    createdByName: "Lucien",
    updatedAt: "2026-10-15T10:00:00Z",
    updatedByName: "Lucien",
  });
}

describe("dashboard confirmed contracts summary", () => {
  const today = new Date("2026-10-17T14:00:00Z");

  it("groups actual retained native quotes into month and year without calling them invoices", () => {
    const summary = calculateDashboardSoldSummary(
      [affair("2026-10-15T10:00:00Z")],
      [quote()],
      today,
    );
    expect(summary.year).toBe("2026");
    expect(summary.month).toBe("2026-10");
    expect(summary.yearly.soldCents).toBe(100000);
    expect(summary.monthly.soldCents).toBe(100000);
    expect(summary.yearly.plannedMarginCents).not.toBeNull();
    expect(summary.yearly.confirmedCases).toBe(1);
  });

  it("shows incomplete instead of reporting a deceptively low revenue", () => {
    const summary = calculateDashboardSoldSummary(
      [affair("2026-10-15T10:00:00Z", []), affair("2026-09-20T10:00:00Z")],
      [quote()],
      today,
    );
    expect(summary.monthly.soldCents).toBeNull();
    expect(summary.monthly.plannedMarginCents).toBeNull();
    expect(summary.monthly.incompleteCases).toBe(1);
    expect(summary.yearly.soldCents).toBeNull();
    expect(summary.yearly.incompleteCases).toBe(1);
  });

  it("uses local Paris calendar for month boundaries", () => {
    const summary = calculateDashboardSoldSummary(
      [affair("2026-09-30T22:30:00Z")],
      [quote()],
      today,
    );
    expect(summary.monthly.soldCents).toBe(100000);
  });

  it("returns zero when no contract was confirmed in the period", () => {
    const summary = calculateDashboardSoldSummary([], [], today);
    expect(summary.monthly.soldCents).toBe(0);
    expect(summary.yearly.soldCents).toBe(0);
    expect(summary.yearly.plannedMarginCents).toBe(0);
  });
});
