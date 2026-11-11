import { describe, expect, it } from "vitest";

import { createInitialEntriesPayload } from "./domain";
import { applyEntriesMutation, type EntriesActor } from "./mutations";

const auteur: EntriesActor = {
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
      auteur,
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
      auteur,
      new Date("2026-10-03T18:05:00.000Z"),
    );

    const resultat = applyEntriesMutation(
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
      auteur,
      new Date("2026-10-03T18:10:00.000Z"),
    );

    const parent = resultat.payload.entries.find(
      (entree) => entree.id === "22222222-2222-4222-8222-222222222222",
    );

    expect(parent?.status).toBe("ASSIGNED");
    expect(parent?.completedAt).toBeNull();
    expect(parent?.derivedEntryIds).toHaveLength(2);

    const children = resultat.payload.entries.filter(
      (entree) => entree.parentEntryId === parent?.id,
    );
    expect(children).toHaveLength(2);
    expect(children.map((entree) => entree.rawText)).toEqual(
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
      auteur,
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
      auteur,
      new Date("2026-10-03T18:05:00.000Z"),
    );

    const resultat = applyEntriesMutation(
      assigned.payload,
      {
        action: "reassign",
        entryId: "33333333-3333-4333-8333-333333333333",
        assigneeName: "Nadia",
        reason: "Nadia reprend le suivi client",
      },
      auteur,
      new Date("2026-10-03T18:10:00.000Z"),
    );

    const entree = resultat.payload.entries.find(
      (element) => element.id === "33333333-3333-4333-8333-333333333333",
    );
    const evenement = entree?.history.find((element) => element.type === "REASSIGNED");

    expect(entree?.assigneeName).toBe("Nadia");
    expect(evenement?.summary).toContain("Motif : Nadia reprend le suivi client");
  });
});
