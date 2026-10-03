import { describe, expect, it } from "vitest";
import {
  calculateQuoteAdjustedPricing,
  createEmptyQuotePricingConfig,
  type QuotePricingConfig,
} from "../src/lib/quotes/adjustments";
import type { QuoteItem, QuoteLine } from "../src/lib/quotes/model";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const lineIds = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
};

function line(
  id: string,
  saleCents: number,
  costCents: number,
  parentId: string | null = null,
  description = id,
): QuoteLine {
  return {
    id,
    kind: "LINE",
    parentId,
    description,
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: saleCents,
    components: [
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
  };
}

function lineWithPose(
  id: string,
  saleCents: number,
  poseHours: number,
  parentId: string | null = null,
  description = id,
  poseCostRateCents = 5_000,
  poseSaleRateCents = 7_000,
): QuoteLine {
  return {
    id,
    kind: "LINE",
    parentId,
    description,
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

describe("quote global adjustments", () => {
  it("passes an architect percentage through at zero margin based on final HT", () => {
    const items: QuoteItem[] = [line(lineIds.a, 10_000_000, 6_000_000, null, "Base")];
    const config: QuotePricingConfig = {
      ...createEmptyQuotePricingConfig(),
      adjustments: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          kind: "PERCENTAGE",
          label: "Commission architecte",
          active: true,
          applyToOptions: true,
          marginTreatment: "PASS_THROUGH",
          percent: 5,
        },
      ],
    };

    const result = calculateQuoteAdjustedPricing(items, config);

    expect(result.lines[0].saleCents).toBe(10_526_316);
    expect(result.totalSaleCents).toBe(10_526_316);
    expect(result.totalCostCents).toBe(6_526_316);
    expect(result.marginAmountCents).toBe(4_000_000);
    expect(result.totalSaleCents - 10_000_000).toBe(526_316);
  });

  it("treats a marged percentage as additional gross margin", () => {
    const items: QuoteItem[] = [line(lineIds.a, 10_000_000, 6_000_000)];
    const result = calculateQuoteAdjustedPricing(items, {
      ...createEmptyQuotePricingConfig(),
      adjustments: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          kind: "PERCENTAGE",
          label: "Marge complémentaire",
          active: true,
          applyToOptions: true,
          marginTreatment: "MARGED",
          percent: 5,
        },
      ],
    });

    expect(result.totalSaleCents).toBe(10_500_000);
    expect(result.totalCostCents).toBe(6_000_000);
    expect(result.marginAmountCents).toBe(4_500_000);
  });

  it("applique une remise client en pourcentage sur le total principal", () => {
    const items: QuoteItem[] = [line(lineIds.a, 10_000, 6_000), line(lineIds.b, 5_000, 3_000)];
    const result = calculateQuoteAdjustedPricing(items, {
      ...createEmptyQuotePricingConfig(),
      customerDiscount: { kind: "PERCENTAGE", percent: 10 },
    });

    expect(result.grossSaleCents).toBe(15_000);
    expect(result.customerDiscountCents).toBe(1_500);
    expect(result.totalSaleCents).toBe(13_500);
    expect(result.lines.map((entry) => entry.saleCents)).toEqual([9_000, 4_500]);
  });

  it("applique une remise client en euros sans toucher aux options en attente", () => {
    const items: QuoteItem[] = [line(lineIds.a, 10_000, 6_000), line(lineIds.b, 5_000, 3_000)];
    const result = calculateQuoteAdjustedPricing(items, {
      adjustments: [],
      options: [
        {
          id: "45454545-4545-4454-8454-454545454545",
          targetItemId: lineIds.b,
          targetKind: "LINE",
          label: "Option",
          status: "PENDING",
        },
      ],
      customerDiscount: { kind: "AMOUNT", amountCents: 2_000 },
    });

    expect(result.grossSaleCents).toBe(10_000);
    expect(result.customerDiscountCents).toBe(2_000);
    expect(result.totalSaleCents).toBe(8_000);
    expect(result.pendingOptionsSaleCents).toBe(5_000);
  });

  it("derives pose hours from components and distributes travel pro rata", () => {
    const items: QuoteItem[] = [
      lineWithPose(lineIds.a, 1_000_000, 20),
      lineWithPose(lineIds.b, 500_000, 10),
      lineWithPose(lineIds.c, 500_000, 10),
    ];
    const result = calculateQuoteAdjustedPricing(items, {
      adjustments: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          kind: "POSE_HOURS",
          label: "Déplacement chantier",
          active: true,
          applyToOptions: false,
          marginTreatment: "MARGED",
          hours: 8,
        },
      ],
      options: [],
    });

    expect(result.lines.map((entry) => entry.basePoseHours)).toEqual([20, 10, 10]);
    expect(result.lines.map((entry) => entry.poseHours)).toEqual([24, 12, 12]);
    expect(result.lines.map((entry) => entry.saleCents)).toEqual([1_028_000, 514_000, 514_000]);
    expect(result.totalPoseHours).toBe(48);
    expect(result.totalCostCents).toBe(240_000);
    expect(result.totalSaleCents).toBe(2_056_000);
  });

  it("reuses the pose cost rate for a zero-margin travel adjustment", () => {
    const items: QuoteItem[] = [lineWithPose(lineIds.a, 100_000, 10)];
    const result = calculateQuoteAdjustedPricing(items, {
      adjustments: [
        {
          id: "67676767-6767-4767-8767-676767676767",
          kind: "POSE_HOURS",
          label: "Déplacement sans marge",
          active: true,
          applyToOptions: false,
          marginTreatment: "PASS_THROUGH",
          hours: 2,
        },
      ],
      options: [],
    });

    expect(result.totalPoseHours).toBe(12);
    expect(result.totalCostCents).toBe(60_000);
    expect(result.totalSaleCents).toBe(110_000);
    expect(result.marginAmountCents).toBe(50_000);
  });

  it("counts only POSE components and respects the quote line quantity", () => {
    const poseLine = lineWithPose(lineIds.a, 100_000, 3);
    poseLine.quantity = 2;
    poseLine.components?.push({
      id: crypto.randomUUID(),
      description: "Heure atelier",
      unit: "h",
      quantity: 50,
      quantityFormula: null,
      activity: "ATELIER",
      costPriceCents: 4_000,
      unitPriceCents: 6_000,
    });

    const result = calculateQuoteAdjustedPricing([poseLine], createEmptyQuotePricingConfig());

    expect(result.lines[0].basePoseHours).toBe(6);
    expect(result.totalPoseHours).toBe(6);
  });

  it("keeps pending single-line and group options outside the main total", () => {
    const sectionId = "77777777-7777-4777-8777-777777777777";
    const items: QuoteItem[] = [
      line(lineIds.a, 4_280_000, 3_000_000, null, "Principal"),
      { id: sectionId, kind: "SECTION", parentId: null, title: "Habillage complémentaire" },
      line(lineIds.b, 245_000, 150_000, sectionId, "Habillage"),
      line(lineIds.c, 178_000, 110_000, null, "Meuble supplémentaire"),
    ];
    const result = calculateQuoteAdjustedPricing(items, {
      adjustments: [],
      options: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          targetItemId: sectionId,
          targetKind: "SECTION",
          label: "Option habillage",
          status: "PENDING",
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          targetItemId: lineIds.c,
          targetKind: "LINE",
          label: "Option meuble",
          status: "PENDING",
        },
      ],
    });

    expect(result.totalSaleCents).toBe(4_280_000);
    expect(result.pendingOptionsSaleCents).toBe(423_000);
    expect(result.options.map((option) => option.saleCents)).toEqual([245_000, 178_000]);
  });

  it("moves a retained option into the principal total without re-entry", () => {
    const items: QuoteItem[] = [
      line(lineIds.a, 4_280_000, 3_000_000),
      line(lineIds.b, 245_000, 150_000),
    ];
    const result = calculateQuoteAdjustedPricing(items, {
      adjustments: [],
      options: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          targetItemId: lineIds.b,
          targetKind: "LINE",
          label: "Option retenue",
          status: "RETAINED",
        },
      ],
    });

    expect(result.totalSaleCents).toBe(4_525_000);
    expect(result.pendingOptionsSaleCents).toBe(0);
  });

  it("applies architect adjustment to pending option prices when configured", () => {
    const items: QuoteItem[] = [line(lineIds.a, 100_000, 60_000), line(lineIds.b, 20_000, 10_000)];
    const result = calculateQuoteAdjustedPricing(items, {
      adjustments: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          kind: "PERCENTAGE",
          label: "Commission architecte",
          active: true,
          applyToOptions: true,
          marginTreatment: "PASS_THROUGH",
          percent: 5,
        },
      ],
      options: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          targetItemId: lineIds.b,
          targetKind: "LINE",
          label: "Option",
          status: "PENDING",
        },
      ],
    });

    expect(result.totalSaleCents).toBe(105_263);
    expect(result.options[0].saleCents).toBe(21_053);
  });

  it("keeps an option price stable when it becomes retained", () => {
    const optionId = "abababab-abab-4bab-8bab-abababababab";
    const items: QuoteItem[] = [line(lineIds.a, 100_000, 60_000), line(lineIds.b, 20_000, 10_000)];
    const adjustments: QuotePricingConfig["adjustments"] = [
      {
        id: "acacacac-acac-4cac-8cac-acacacacacac",
        kind: "PERCENTAGE",
        label: "Commission architecte",
        active: true,
        applyToOptions: true,
        marginTreatment: "PASS_THROUGH",
        percent: 5,
      },
    ];
    const pending = calculateQuoteAdjustedPricing(items, {
      adjustments,
      options: [
        {
          id: optionId,
          targetItemId: lineIds.b,
          targetKind: "LINE",
          label: "Option",
          status: "PENDING",
        },
      ],
    });
    const retained = calculateQuoteAdjustedPricing(items, {
      adjustments,
      options: [
        {
          id: optionId,
          targetItemId: lineIds.b,
          targetKind: "LINE",
          label: "Option",
          status: "RETAINED",
        },
      ],
    });

    expect(pending.options[0].saleCents).toBe(21_053);
    expect(retained.options[0].saleCents).toBe(21_053);
    expect(retained.totalSaleCents).toBe(126_316);
  });

  it("does not apply a disabled adjustment", () => {
    const items: QuoteItem[] = [line(lineIds.a, 100_000, 60_000)];
    const result = calculateQuoteAdjustedPricing(items, {
      ...createEmptyQuotePricingConfig(),
      adjustments: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          kind: "PERCENTAGE",
          label: "Test",
          active: false,
          applyToOptions: true,
          marginTreatment: "MARGED",
          percent: 25,
        },
      ],
    });

    expect(result.totalSaleCents).toBe(100_000);
    expect(result.marginAmountCents).toBe(40_000);
  });

  it("keeps line distribution exactly aligned with the rounded quote total", () => {
    const items: QuoteItem[] = [
      line(lineIds.a, 101, 50),
      line(lineIds.b, 101, 50),
      line(lineIds.c, 101, 50),
    ];
    const result = calculateQuoteAdjustedPricing(items, {
      ...createEmptyQuotePricingConfig(),
      adjustments: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          kind: "PERCENTAGE",
          label: "Marge",
          active: true,
          applyToOptions: true,
          marginTreatment: "MARGED",
          percent: 5,
        },
      ],
    });

    expect(result.totalSaleCents).toBe(318);
    expect(result.lines.reduce((sum, entry) => sum + entry.saleCents, 0)).toBe(318);
  });

  it("loads older quote records with an empty pricing configuration", () => {
    const payload = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          commercialCaseId: "12121212-1212-4212-8212-121212121212",
          variantName: "Base",
          version: 1,
          status: "DRAFT",
          model: {
            id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            clientId: "13131313-1313-4313-8313-131313131313",
            subject: "Ancien devis",
            issueDate: "2026-09-15",
            validityDays: 30,
            paymentTerms: "45 jours fin de mois",
            items: [],
          },
          createdAt: "2026-09-15T08:00:00.000Z",
          createdByName: "Lucien",
          updatedAt: "2026-09-15T08:00:00.000Z",
          updatedByName: "Lucien",
        },
      ],
    });

    expect(payload.quotes[0].pricingConfig).toEqual(createEmptyQuotePricingConfig());
  });
});
