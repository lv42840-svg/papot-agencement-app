import { describe, expect, it } from "vitest";

import { createInitialEntriesPayload } from "./domain";
import { applyEntriesMutation, type EntriesActor } from "./mutations";

const actor: EntriesActor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
  canQualify: true,
  assignmentCandidates: ["Lucien", "Nadia", "Stéphane"],
};

describe("entries assigned actions and reassignment", () => {
  it("creates several linked actions without completing the assigned entry", () => {
    const created = applyEntriesMutation(
      createInitialEntriesPayload(),
      {
        action: "create",
        entryId: "22222222-2222-4222-8222-222222222222",
        rawText: "Préparer dossier client",
        priority: "NORMAL",
        tagIds: [],
      },
      actor,
      new Date("2026-10-03T18:00:00.000Z"),
    );

    const assigned = applyEntriesMutation(
      created.payload,
      {
        action: "qualifyAssign",
        entryId: "22222222-2222-4222-8222-222222222222",
        description: "Dossier à préparer",
        nextAction: "Préparer les éléments",
        assigneeName: "Lucien",
        dueDate: "2026-10-06",
        tagIds: [],
      },
      actor,
      new Date("2026-10-03T18:05:00.000Z"),
    );

    const result = applyEntriesMutation(
      assigned.payload,
      {
        action: "assignedActions",
        entryId: "22222222-2222-4222-8222-222222222222",
        actions: [
          {
            text: "Appeler le client",
            assigneeName: "Nadia",
            dueDate: "2026-10-05",
          },
          {
            text: "Préparer le devis",
            assigneeName: "Lucien",
            dueDate: "2026-10-07",
          },
        ],
      },
      actor,
      new Date("2026-10-03T18:10:00.000Z"),
    );

    const parent = result.payload.entries.find(
      (entry) => entry.id === "22222222-2222-4222-8222-222222222222",
    );

    expect(parent?.status).toBe("ASSIGNED");
    expect(parent?.completedAt).toBeNull();
    expect(parent?.derivedEntryIds).toHaveLength(2);

    const children = result.payload.entries.filter((entry) => entry.parentEntryId === parent?.id);
    expect(children).toHaveLength(2);
    expect(children.map((entry) => entry.rawText)).toEqual(
      expect.arrayContaining(["Appeler le client", "Préparer le devis"]),
    );
  });

  it("keeps the reassignment reason in the entry history", () => {
    const created = applyEntriesMutation(
      createInitialEntriesPayload(),
      {
        action: "create",
        entryId: "33333333-3333-4333-8333-333333333333",
        rawText: "Relancer le client",
        priority: "NORMAL",
        tagIds: [],
      },
      actor,
      new Date("2026-10-03T18:00:00.000Z"),
    );

    const assigned = applyEntriesMutation(
      created.payload,
      {
        action: "qualifyAssign",
        entryId: "33333333-3333-4333-8333-333333333333",
        description: "Relance commerciale",
        nextAction: "Téléphoner",
        assigneeName: "Lucien",
        dueDate: "2026-10-06",
        tagIds: [],
      },
      actor,
      new Date("2026-10-03T18:05:00.000Z"),
    );

    const result = applyEntriesMutation(
      assigned.payload,
      {
        action: "reassign",
        entryId: "33333333-3333-4333-8333-333333333333",
        assigneeName: "Nadia",
        reason: "Nadia reprend le suivi client",
      },
      actor,
      new Date("2026-10-03T18:10:00.000Z"),
    );

    const entry = result.payload.entries.find(
      (item) => item.id === "33333333-3333-4333-8333-333333333333",
    );
    const event = entry?.history.find((item) => item.type === "REASSIGNED");

    expect(entry?.assigneeName).toBe("Nadia");
    expect(event?.summary).toContain("Motif : Nadia reprend le suivi client");
  });
});
