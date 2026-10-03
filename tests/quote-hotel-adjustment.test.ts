import { describe, expect, it } from "vitest";
import {
  calculateQuoteAdjustedPricing,
  quotePricingConfigSchema,
  type QuotePricingConfig,
} from "../src/lib/quotes/adjustments";
import type { QuoteItem, QuoteLine } from "../src/lib/quotes/model";

const lineIds = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
};

function lineWithPose(
  id: string,
  saleCents: number,
  poseHours: number,
  poseCostRateCents = 5_000,
  poseSaleRateCents = 7_000,
): QuoteLine {
  return {
    id,
    kind: "LINE",
    parentId: null,
    description: id,
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: saleCents,
    components: [
      {
        id: crypto.randomUUID(),
        description: "Heure pose",
        unit: "h",
        quantity: poseHours,
        quantityFormula: null,
        activity: "POSE",
        costPriceCents: poseCostRateCents,
        unitPriceCents: poseSaleRateCents,
      },
    ],
  };
}

function hotelConfig(
  marginTreatment: "MARGED" | "PASS_THROUGH" = "PASS_THROUGH",
  nights = 3,
  pricePerNightCents = 12_000,
): QuotePricingConfig {
  return {
    adjustments: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        kind: "HOTEL",
        label: "Hôtel chantier",
        active: true,
        applyToOptions: false,
        marginTreatment,
        nights,
        pricePerNightCents,
      },
    ],
    options: [],
  };
}

describe("quote hotel adjustment", () => {
  it("distributes nights times price per night pro rata to pose hours", () => {
    const items: QuoteItem[] = [
      lineWithPose(lineIds.a, 1_000_000, 20),
      lineWithPose(lineIds.b, 500_000, 10),
      lineWithPose(lineIds.c, 500_000, 10),
    ];

    const result = calculateQuoteAdjustedPricing(items, hotelConfig());

    expect(result.lines.map((line) => line.saleCents - line.baseSaleCents)).toEqual([
      18_000, 9_000, 9_000,
    ]);
    expect(result.totalSaleCents).toBe(2_036_000);
    expect(result.totalCostCents).toBe(236_000);
    expect(result.totalPoseHours).toBe(40);
    expect(result.warnings).toEqual([]);
  });

  it("uses the pose cost to sale coefficient when the hotel is marged", () => {
    const items: QuoteItem[] = [
      lineWithPose(lineIds.a, 1_000_000, 20),
      lineWithPose(lineIds.b, 500_000, 10),
      lineWithPose(lineIds.c, 500_000, 10),
    ];

    const result = calculateQuoteAdjustedPricing(items, hotelConfig("MARGED"));

    expect(result.lines.map((line) => line.saleCents - line.baseSaleCents)).toEqual([
      25_200, 12_600, 12_600,
    ]);
    expect(result.totalSaleCents).toBe(2_050_400);
    expect(result.totalCostCents).toBe(236_000);
    expect(result.warnings).toEqual([]);
  });

  it("keeps the distributed hotel amount exact to the cent", () => {
    const items: QuoteItem[] = [
      lineWithPose(lineIds.a, 10_000, 1),
      lineWithPose(lineIds.b, 10_000, 1),
      lineWithPose(lineIds.c, 10_000, 1),
    ];

    const result = calculateQuoteAdjustedPricing(items, hotelConfig("PASS_THROUGH", 1, 1));
    const increments = result.lines.map((line) => line.saleCents - line.baseSaleCents);

    expect(increments.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(increments).toEqual([1, 0, 0]);
  });

  it("does not spread hotel costs onto lines without pose hours", () => {
    const items: QuoteItem[] = [
      {
        id: lineIds.a,
        kind: "LINE",
        parentId: null,
        description: "Sans pose",
        unit: "u",
        quantity: 1,
        quantityFormula: null,
        unitPriceCents: 100_000,
        components: [
          {
            id: crypto.randomUUID(),
            description: "Panneau",
            unit: "u",
            quantity: 1,
            quantityFormula: null,
            costPriceCents: 60_000,
            unitPriceCents: 100_000,
          },
        ],
      },
    ];

    const result = calculateQuoteAdjustedPricing(items, hotelConfig());

    expect(result.totalSaleCents).toBe(100_000);
    expect(result.totalCostCents).toBe(60_000);
    expect(result.warnings[0]).toMatch(/^QUOTE_HOTEL_NO_POSE_HOURS:/);
  });

  it("keeps a hotel adjustment on the principal quote only", () => {
    const parsed = quotePricingConfigSchema.safeParse({
      adjustments: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          kind: "HOTEL",
          label: "Hôtel chantier",
          active: true,
          applyToOptions: true,
          marginTreatment: "PASS_THROUGH",
          nights: 2,
          pricePerNightCents: 10_000,
        },
      ],
      options: [],
    });

    expect(parsed.success).toBe(false);
  });
});
