import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { filterCommercialCases } from "../src/lib/commercial/list-filter";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import type { CommercialPayload } from "../src/lib/commercial/domain";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const mutationNow = new Date("2026-09-01T08:00:00.000Z");

function addPiste(source: CommercialPayload, name: string) {
  const result = applyCommercialMutation(
    source,
    {
      action: "create",
      name,
      clientName: "Client test",
      siteLabel: "",
      description: "",
      nextAction: "",
      reviewDate: "2026-10-15",
    },
    actor,
    mutationNow,
  );
  if (!result.focusCaseId) throw new Error("TEST_CASE_ID_MISSING");
  return { payload: result.payload, caseId: result.focusCaseId };
}

describe("commercial list filters", () => {
  it("uses the four count cards as the list filters", () => {
    let payload = createInitialCommercialPayload();

    const piste = addPiste(payload, "Piste active");
    payload = piste.payload;

    const sent = addPiste(payload, "Devis envoyé");
    payload = applyCommercialMutation(
      sent.payload,
      {
        action: "markQuoteSent",
        caseId: sent.caseId,
        followUpDate: "2026-09-10",
      },
      actor,
      mutationNow,
    ).payload;

    const confirmed = addPiste(payload, "Affaire validée");
    payload = applyCommercialMutation(
      confirmed.payload,
      {
        action: "setStatus",
        caseId: confirmed.caseId,
        status: "CONFIRMED",
        plannedInstallDate: "2026-11-20",
      },
      actor,
      mutationNow,
    ).payload;

    const archived = addPiste(payload, "Affaire archivée");
    payload = applyCommercialMutation(
      archived.payload,
      {
        action: "close",
        caseId: archived.caseId,
        status: "LOST",
        reason: "Sans suite",
      },
      actor,
      mutationNow,
    ).payload;

    const now = new Date("2026-09-15T08:00:00.000Z");

    expect(filterCommercialCases(payload.cases, "active", now).map((item) => item.name).sort()).toEqual(
      ["Devis envoyé", "Piste active"],
    );
    expect(filterCommercialCases(payload.cases, "follow-up", now).map((item) => item.name)).toEqual([
      "Devis envoyé",
    ]);
    expect(filterCommercialCases(payload.cases, "confirmed", now).map((item) => item.name)).toEqual([
      "Affaire validée",
    ]);
    expect(filterCommercialCases(payload.cases, "archives", now).map((item) => item.name)).toEqual([
      "Affaire archivée",
    ]);
  });
});
