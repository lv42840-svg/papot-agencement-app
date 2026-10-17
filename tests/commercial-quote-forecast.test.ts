import { describe, expect, it } from "vitest";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import {
  assertForecastQuoteSelection,
  effectiveCommercialForecastHours,
} from "../src/lib/commercial/forecast-quotes";
import { nativeQuoteRecordSchema } from "../src/lib/quotes/store";
import {
  buildCommercialProvisionRows,
  createInitialPlanningPayload,
} from "../src/lib/planning/domain";
import { commercialSpecialPermissionForMutation } from "../src/lib/auth/action-permissions";

const affairId = "11111111-1111-4111-8111-111111111111";
const outsiderId = "22222222-2222-4222-8222-222222222222";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
const otherId = "55555555-5555-4555-8555-555555555555";
const actor = { userId: outsiderId, displayName: "Lucien" };

function quote(id: string, commercialCaseId: string, workshopHours: number) {
  return nativeQuoteRecordSchema.parse({
    id,
    commercialCaseId,
    variantName: "Base",
    version: 1,
    status: "DRAFT",
    model: {
      id,
      clientId: outsiderId,
      subject: "Mobilier test",
      issueDate: "2026-10-15",
      validityDays: 30,
      paymentTerms: "45 jours",
      items: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          kind: "LINE",
          parentId: null,
          description: "Fabrication",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          unitPriceCents: 10000,
          components: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              activity: "ATELIER",
              description: "Atelier",
              unit: "h",
              quantity: workshopHours,
              quantityFormula: null,
              costPriceCents: 1000,
              unitPriceCents: 1500,
            },
          ],
        },
      ],
    },
    createdAt: "2026-10-15T10:00:00.000Z",
    updatedAt: "2026-10-15T10:00:00.000Z",
    createdByName: "Lucien",
    updatedByName: "Lucien",
  });
}

const quotes = [
  quote(firstId, affairId, 12),
  quote(secondId, affairId, 6),
  quote(otherId, outsiderId, 100),
];

function affairPayload() {
  const payload = applyCommercialMutation(
    createInitialCommercialPayload(),
    { action: "create", name: "Affaire test", clientName: "Client", reviewDate: "2026-11-15" },
    actor,
    new Date("2026-10-15T10:00:00.000Z"),
  ).payload;
  payload.cases[0].id = affairId;
  payload.cases[0].provisionHours = { be: 4, workshop: 30, install: 2 };
  return payload;
}

describe("affair quote selection driving the commercial forecast", () => {
  it("preserves the legacy/manual hours before quote selection", () => {
    const payload = affairPayload();
    const before = effectiveCommercialForecastHours(payload.cases[0], quotes);
    expect(before).toEqual({ be: 4, workshop: 30, install: 2 });
    const rows = buildCommercialProvisionRows(
      payload,
      createInitialPlanningPayload(),
      2026,
      2026,
      quotes,
    );
    expect(rows[0].activities.map((activity) => activity.provisionHours)).toEqual([4, 30, 2]);
  });

  it("adds only checked quotes without summing the manual reference or other affair quotes", () => {
    const source = affairPayload();
    const picked = applyCommercialMutation(
      source,
      { action: "setForecastQuotes", caseId: affairId, quoteIds: [firstId, secondId] },
      actor,
      new Date("2026-10-16T10:00:00.000Z"),
    ).payload;
    expect(effectiveCommercialForecastHours(picked.cases[0], quotes)).toEqual({
      be: 0,
      workshop: 18,
      install: 0,
    });
    const rows = buildCommercialProvisionRows(
      picked,
      createInitialPlanningPayload(),
      2026,
      2027,
      quotes,
    );
    expect(rows[0].activities.map((activity) => activity.provisionHours)).toEqual([0, 18, 0]);
    expect(rows[0].activities[1].remainingHours).toBe(18);
    expect(picked.cases[0].history.at(-1)?.type).toBe("FORECAST_QUOTES_UPDATED");
  });

  it("all unchecked means zero provisional quote hours, and manual mode can be restored", () => {
    const source = affairPayload();
    const empty = applyCommercialMutation(
      source,
      { action: "setForecastQuotes", caseId: affairId, quoteIds: [] },
      actor,
    ).payload;
    expect(effectiveCommercialForecastHours(empty.cases[0], quotes)).toEqual({
      be: 0,
      workshop: 0,
      install: 0,
    });
    expect(
      buildCommercialProvisionRows(empty, createInitialPlanningPayload(), 2026, 2026, quotes),
    ).toEqual([]);
    const manual = applyCommercialMutation(
      empty,
      { action: "useManualProvision", caseId: affairId },
      actor,
    ).payload;
    expect(effectiveCommercialForecastHours(manual.cases[0], quotes).workshop).toBe(30);
    expect(source.cases[0].forecastQuoteIds).toBeNull();
  });

  it("refuses a quote from another affair, unknown quotes and duplicates", () => {
    expect(() => assertForecastQuoteSelection(affairId, [otherId], quotes)).toThrow(
      "COMMERCIAL_FORECAST_QUOTE_NOT_IN_AFFAIR",
    );
    expect(() =>
      assertForecastQuoteSelection(affairId, ["99999999-9999-4999-8999-999999999999"], quotes),
    ).toThrow();
    expect(() => assertForecastQuoteSelection(affairId, [firstId, firstId], quotes)).toThrow(
      "COMMERCIAL_FORECAST_QUOTE_DUPLICATE",
    );
  });

  it("requires commercial.provision permission for selecting quotes and returning to manual mode", () => {
    expect(commercialSpecialPermissionForMutation({ action: "setForecastQuotes" })).toBe(
      "commercial.provision",
    );
    expect(commercialSpecialPermissionForMutation({ action: "useManualProvision" })).toBe(
      "commercial.provision",
    );
  });
});
