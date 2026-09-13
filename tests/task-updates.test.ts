import { describe, expect, it } from "vitest";
import { createInitialEntriesPayload } from "../src/lib/entries/domain";
import { applyEntriesMutation } from "../src/lib/entries/mutations";

const lucien = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

const nadia = {
  userId: "22222222-2222-4222-8222-222222222222",
  displayName: "Nadia",
};

describe("Mes tâches updates", () => {
  it("lets the current assignee edit task details without changing the original capture or deadline", () => {
    const created = applyEntriesMutation(
      createInitialEntriesPayload(),
      {
        action: "create",
        rawText: "Appeler Martin pour le dressing",
        priority: "NORMAL",
        tagIds: ["contact"],
      },
      nadia,
      new Date("2026-09-13T07:00:00.000Z"),
    ).payload;
    const entryId = created.entries[0].id;

    const assigned = applyEntriesMutation(
      created,
      {
        action: "qualifyAssign",
        entryId,
        description: "Dossier dressing Martin",
        nextAction: "Appeler le client",
        assigneeName: "Lucien",
        dueDate: "2026-09-17",
        tagIds: ["contact"],
      },
      nadia,
      new Date("2026-09-13T07:05:00.000Z"),
    ).payload;

    const updated = applyEntriesMutation(
      assigned,
      {
        action: "updateAssigned",
        entryId,
        description: "Dossier dressing Martin avec retour technique",
        nextAction: "Appeler le client puis envoyer le récapitulatif",
        priority: "URGENT",
        tagIds: ["contact", "devis"],
      },
      lucien,
      new Date("2026-09-13T07:10:00.000Z"),
    ).payload.entries[0];

    expect(updated.rawText).toBe("Appeler Martin pour le dressing");
    expect(updated.dueDate).toBe("2026-09-17");
    expect(updated.structuredDescription).toBe("Dossier dressing Martin avec retour technique");
    expect(updated.nextAction).toBe("Appeler le client puis envoyer le récapitulatif");
    expect(updated.priority).toBe("URGENT");
    expect(updated.tagIds).toEqual(["contact", "devis"]);
    expect(updated.history.at(-1)?.summary).toContain("Mes tâches");
  });

  it("rejects task edits from someone who is not the current assignee", () => {
    const created = applyEntriesMutation(
      createInitialEntriesPayload(),
      {
        action: "create",
        rawText: "Relancer Dupont",
        priority: "NORMAL",
        tagIds: ["contact"],
      },
      nadia,
    ).payload;
    const entryId = created.entries[0].id;
    const assigned = applyEntriesMutation(
      created,
      {
        action: "qualifyAssign",
        entryId,
        description: "Relance Dupont",
        nextAction: "Téléphoner",
        assigneeName: "Lucien",
        dueDate: "2026-09-20",
        tagIds: ["contact"],
      },
      nadia,
    ).payload;

    expect(() =>
      applyEntriesMutation(
        assigned,
        {
          action: "updateAssigned",
          entryId,
          description: "Modification interdite",
          nextAction: "Ne doit pas passer",
          priority: "NORMAL",
          tagIds: ["contact"],
        },
        nadia,
      ),
    ).toThrow("ENTRY_NOT_ASSIGNED_TO_ACTOR");
  });
});
