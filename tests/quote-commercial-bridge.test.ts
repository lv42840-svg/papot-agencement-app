import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation, commercialMutationSchema } from "../src/lib/commercial/mutations";
import { startQuoteCommercialWorkflow } from "../src/lib/quotes/commercial-bridge";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

function createAffair() {
  return applyCommercialMutation(
    createInitialCommercialPayload(),
    commercialMutationSchema.parse({
      action: "create",
      name: "Accueil mairie",
      reviewDate: "2026-09-18",
    }),
    actor,
    new Date("2026-09-16T12:00:00.000Z"),
  );
}

describe("quote commercial bridge", () => {
  it("passe l'affaire en chiffrage avec responsable et date prevue", () => {
    const created = createAffair();
    const caseId = created.focusCaseId!;
    const result = startQuoteCommercialWorkflow(
      created.payload,
      caseId,
      "Lucien",
      "2026-09-25",
      actor,
      new Date("2026-09-16T13:00:00.000Z"),
    );
    const affair = result.payload.cases.find((item) => item.id === caseId);

    expect(affair).toMatchObject({
      status: "CHIFFRAGE",
      quoteOwnerName: "Lucien",
      quoteDueDate: "2026-09-25",
      reviewDate: null,
    });
    expect(affair?.history.at(-1)?.summary).toContain("Chiffrage en cours");
  });

  it("refuse le chiffrage sans responsable ou date", () => {
    const created = createAffair();
    const caseId = created.focusCaseId!;

    expect(() =>
      startQuoteCommercialWorkflow(created.payload, caseId, "", "2026-09-25", actor),
    ).toThrow("COMMERCIAL_QUOTE_OWNER_AND_DATE_REQUIRED");
  });
});
