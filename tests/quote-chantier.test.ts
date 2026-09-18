import { describe, expect, it } from "vitest";
import {
  nextChantierComplementVariantName,
  quoteWorkflowMayChangeCommercialStatus,
} from "../src/lib/quotes/chantier";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import {
  createInitialNativeQuotesPayload,
  nativeQuoteRecordSchema,
} from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

describe("chantier native quote workflow", () => {
  it("creates a TS with the same native quote mutation", () => {
    const result = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      quotesMutationSchema.parse({
        action: "createDraft",
        commercialCaseId: affairId,
        quoteKind: "TS",
        subject: "Ajout tablette",
        issueDate: "2026-09-18",
        variantName: "Complément 1",
        paymentTerms: "45 jours fin de mois",
      }),
      actor,
      clientId,
      new Date("2026-09-18T08:00:00.000Z"),
    );

    expect(result.payload.quotes).toHaveLength(1);
    expect(result.payload.quotes[0]).toMatchObject({
      commercialCaseId: affairId,
      quoteKind: "TS",
      variantName: "Complément 1",
      version: 1,
      status: "DRAFT",
    });
  });

  it("gives chantier complements their own names instead of creating Base V2", () => {
    const existing = nativeQuoteRecordSchema.parse({
      id: "44444444-4444-4444-8444-444444444444",
      commercialCaseId: affairId,
      quoteKind: "STANDARD",
      variantName: "Complément 1",
      version: 1,
      status: "DRAFT",
      model: {
        id: "44444444-4444-4444-8444-444444444444",
        clientId,
        subject: "Premier complément",
        issueDate: "2026-09-18",
        validityDays: 30,
        paymentTerms: "45 jours fin de mois",
        items: [],
      },
      createdAt: "2026-09-18T07:00:00.000Z",
      createdByName: "Lucien",
      updatedAt: "2026-09-18T07:00:00.000Z",
      updatedByName: "Lucien",
    });

    expect(
      nextChantierComplementVariantName({ schemaVersion: 1, quotes: [existing] }, affairId),
    ).toBe("Complément 2");
  });

  it("keeps a confirmed affair confirmed during complement creation and send", () => {
    expect(quoteWorkflowMayChangeCommercialStatus("CONFIRMED")).toBe(false);
    expect(quoteWorkflowMayChangeCommercialStatus("PISTE")).toBe(true);
    expect(quoteWorkflowMayChangeCommercialStatus("CHIFFRAGE")).toBe(true);
  });
});
