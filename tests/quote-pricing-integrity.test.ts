import { describe, expect, it } from "vitest";
import {
  calculateQuoteAdjustedPricing,
  type QuoteOption,
  type QuotePricingConfig,
} from "../src/lib/quotes/adjustments";
import type { QuoteItem, QuoteLine } from "../src/lib/quotes/model";
import {
  assertQuoteOptionCanBeUpserted,
  normalizeQuotePricingAfterModelMutation,
} from "../src/lib/quotes/pricing-integrity";
import { markNativeQuoteSent } from "../src/lib/quotes/send";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const quoteId = "22222222-2222-4222-8222-222222222222";
const affairId = "33333333-3333-4333-8333-333333333333";
const clientId = "44444444-4444-4444-8444-444444444444";
const sectionId = "55555555-5555-4555-8555-555555555555";
const lineId = "66666666-6666-4666-8666-666666666666";

function poseLine(): QuoteLine {
  return {
    id: lineId,
    kind: "LINE",
    parentId: null,
    description: "Pose",
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: 100_000,
    components: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        description: "Heure pose",
        unit: "h",
        quantity: 10,
        quantityFormula: null,
        activity: "POSE",
        costPriceCents: 5_000,
        unitPriceCents: 7_000,
      },
    ],
  };
}

function payload(items: QuoteItem[], pricingConfig: QuotePricingConfig) {
  return parseNativeQuotesPayload({
    schemaVersion: 1,
    quotes: [
      {
        id: quoteId,
        commercialCaseId: affairId,
        variantName: "Base",
        version: 1,
        status: "DRAFT",
        pricingConfig,
        model: {
          id: quoteId,
          clientId,
          subject: "Agencement accueil",
          issueDate: "2026-09-15",
          validityDays: 30,
          paymentTerms: "45 jours fin de mois",
          items,
        },
        createdAt: "2026-09-15T08:00:00.000Z",
        createdByName: "Lucien",
        updatedAt: "2026-09-15T08:00:00.000Z",
        updatedByName: "Lucien",
      },
    ],
  });
}

describe("quote pricing integrity", () => {
  it("applies pose hours first, PAPOT margin second and commission last", () => {
    const adjustments: QuotePricingConfig["adjustments"] = [
      {
        id: "88888888-8888-4888-8888-888888888888",
        kind: "PERCENTAGE",
        label: "Commission architecte",
        active: true,
        applyToOptions: true,
        marginTreatment: "PASS_THROUGH",
        percent: 5,
      },
      {
        id: "99999999-9999-4999-8999-999999999999",
        kind: "PERCENTAGE",
        label: "Marge supplémentaire PAPOT",
        active: true,
        applyToOptions: true,
        marginTreatment: "MARGED",
        percent: 10,
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "POSE_HOURS",
        label: "Déplacement chantier",
        active: true,
        applyToOptions: false,
        marginTreatment: "MARGED",
        hours: 2,
      },
    ];

    const result = calculateQuoteAdjustedPricing([poseLine()], {
      adjustments,
      options: [],
    });

    // 1000 € + 2 h x 70 € = 1140 € ; +10 % PAPOT = 1254 € ;
    // commission 5 % du montant final = 1320 €.
    expect(result.lines[0].poseHours).toBe(12);
    expect(result.lines[0].saleCents).toBe(132_000);
    expect(result.totalSaleCents).toBe(132_000);
    expect(result.totalCostCents).toBe(66_600);
    expect(result.marginAmountCents).toBe(65_400);
  });

  it("rejects nested options so a group and one of its lines cannot both be options", () => {
    const items: QuoteItem[] = [
      { id: sectionId, kind: "SECTION", parentId: null, title: "Mobilier" },
      { ...poseLine(), parentId: sectionId },
    ];
    const existing: QuoteOption = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      targetItemId: sectionId,
      targetKind: "SECTION",
      label: "Option mobilier",
      status: "PENDING",
    };
    const nested: QuoteOption = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      targetItemId: lineId,
      targetKind: "LINE",
      label: "Option pose",
      status: "PENDING",
    };

    expect(() => assertQuoteOptionCanBeUpserted(items, [existing], nested)).toThrow(
      "QUOTE_OPTION_TARGET_DUPLICATE",
    );
  });

  it("removes an orphan option after its target is deleted", () => {
    const source = payload([poseLine()], {
      adjustments: [],
      options: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          targetItemId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          targetKind: "LINE",
          label: "Ancienne option",
          status: "PENDING",
        },
      ],
    });

    normalizeQuotePricingAfterModelMutation(source, quoteId);

    expect(source.quotes[0].pricingConfig.options).toEqual([]);
  });

  it("cleans a legacy orphan option before marking a quote sent", () => {
    const source = payload([poseLine()], {
      adjustments: [],
      options: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          targetItemId: "12121212-1212-4212-8212-121212121212",
          targetKind: "LINE",
          label: "Option supprimée",
          status: "PENDING",
        },
      ],
    });

    const result = markNativeQuoteSent(
      source,
      quoteId,
      "2026-09-30",
      actor,
      new Date("2026-09-15T09:00:00.000Z"),
    );

    expect(result.payload.quotes[0].status).toBe("SENT");
    expect(result.payload.quotes[0].pricingConfig.options).toEqual([]);
  });

  it("blocks sending when a pricing warning still needs review", () => {
    const noPoseLine: QuoteLine = {
      ...poseLine(),
      components: [
        {
          id: "13131313-1313-4313-8313-131313131313",
          description: "Panneau",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          costPriceCents: 50_000,
          unitPriceCents: 100_000,
        },
      ],
    };
    const source = payload([noPoseLine], {
      adjustments: [
        {
          id: "14141414-1414-4414-8414-141414141414",
          kind: "POSE_HOURS",
          label: "Déplacement chantier",
          active: true,
          applyToOptions: false,
          marginTreatment: "MARGED",
          hours: 2,
        },
      ],
      options: [],
    });

    expect(() => markNativeQuoteSent(source, quoteId, "2026-09-30", actor)).toThrow(
      "QUOTE_PRICING_REVIEW_REQUIRED",
    );
  });
});
