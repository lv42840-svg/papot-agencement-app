import { describe, expect, it } from "vitest";
import {
  createInitialCommercialPayload,
  parseCommercialPayload,
} from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

describe("Commercial created from tasks", () => {
  it("keeps the source task link and copies useful task context", () => {
    const sourceEntryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = applyCommercialMutation(
      createInitialCommercialPayload(),
      {
        action: "create",
        sourceEntryId,
        name: "Cuisine Martin",
        clientName: "Martin",
        siteLabel: "Roanne",
        reviewDate: "2026-09-18",
        description: "Cuisine complète à chiffrer",
        nextAction: "Préparer le chiffrage",
      },
      actor,
      new Date("2026-09-13T08:00:00.000Z"),
    ).payload.cases[0];

    expect(result.sourceEntryId).toBe(sourceEntryId);
    expect(result.description).toBe("Cuisine complète à chiffrer");
    expect(result.nextAction).toBe("Préparer le chiffrage");
    expect(result.history[0].summary).toContain("depuis une tâche PAPOT");
  });

  it("prevents duplicate commercial cases from the same task", () => {
    const sourceEntryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const first = applyCommercialMutation(
      createInitialCommercialPayload(),
      {
        action: "create",
        sourceEntryId,
        name: "Dressing Dupont",
        clientName: "",
        siteLabel: "",
        reviewDate: "2026-09-18",
        description: "",
        nextAction: "",
      },
      actor,
    ).payload;

    expect(() =>
      applyCommercialMutation(
        first,
        {
          action: "create",
          sourceEntryId,
          name: "Dressing Dupont bis",
          clientName: "",
          siteLabel: "",
          reviewDate: "2026-09-19",
          description: "",
          nextAction: "",
        },
        actor,
      ),
    ).toThrow("COMMERCIAL_SOURCE_TASK_ALREADY_LINKED");
  });

  it("parses older commercial cases without a source task link", () => {
    const source = applyCommercialMutation(
      createInitialCommercialPayload(),
      {
        action: "create",
        name: "Ancienne affaire",
        clientName: "",
        siteLabel: "",
        reviewDate: "2026-09-20",
        description: "",
        nextAction: "",
      },
      actor,
    ).payload;

    const legacy = structuredClone(source) as unknown as { cases: Array<Record<string, unknown>> };
    delete legacy.cases[0].sourceEntryId;

    expect(parseCommercialPayload(legacy).cases[0].sourceEntryId).toBeNull();
  });
});
