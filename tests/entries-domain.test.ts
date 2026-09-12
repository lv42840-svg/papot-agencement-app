import { describe, expect, it } from "vitest";
import {
  addFrenchBusinessHours,
  createInitialEntriesPayload,
  frenchNationalHolidayKeys,
  isQualificationAttentionDue,
} from "../src/lib/entries/domain";
import { applyEntriesMutation } from "../src/lib/entries/mutations";

const lucien = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

const nadia = {
  userId: "22222222-2222-4222-8222-222222222222",
  displayName: "Nadia",
};

describe("Entries business rules", () => {
  it("excludes weekends from the 48 business-hour qualification threshold", () => {
    const fridayAtFourPmParis = new Date("2026-09-11T14:00:00.000Z");

    expect(addFrenchBusinessHours(fridayAtFourPmParis, 48).toISOString()).toBe(
      "2026-09-15T14:00:00.000Z",
    );
  });

  it("excludes French national public holidays from the qualification threshold", () => {
    expect(frenchNationalHolidayKeys(2026).has("2026-05-14")).toBe(true);

    const wednesdayBeforeAscensionAtTenAmParis = new Date("2026-05-13T08:00:00.000Z");
    expect(addFrenchBusinessHours(wednesdayBeforeAscensionAtTenAmParis, 48).toISOString()).toBe(
      "2026-05-18T08:00:00.000Z",
    );
  });

  it("keeps a quick capture in À qualifier with its original text and multiple tags", () => {
    const initial = createInitialEntriesPayload();
    const created = applyEntriesMutation(
      initial,
      {
        action: "create",
        rawText: "Dupont réunion chantier et retour pose",
        priority: "NORMAL",
        tagIds: ["compte-rendu-chantier", "intervention-chantier"],
      },
      lucien,
      new Date("2026-09-12T10:00:00.000Z"),
    ).payload;

    expect(created.entries).toHaveLength(1);
    expect(created.entries[0]).toMatchObject({
      rawText: "Dupont réunion chantier et retour pose",
      status: "TO_QUALIFY",
      tagIds: ["compte-rendu-chantier", "intervention-chantier"],
    });
  });

  it("requires C'est quoi, J'en fais quoi, a responsible person and a deadline before assignment", () => {
    const initial = createInitialEntriesPayload();
    const created = applyEntriesMutation(
      initial,
      {
        action: "create",
        rawText: "Martin devis dressing",
        priority: "NORMAL",
        tagIds: ["devis"],
      },
      lucien,
      new Date("2026-09-12T10:00:00.000Z"),
    ).payload;
    const entryId = created.entries[0].id;

    const assigned = applyEntriesMutation(
      created,
      {
        action: "qualifyAssign",
        entryId,
        description: "Chiffrer un dressing pour Martin",
        nextAction: "Préparer le devis client",
        assigneeName: "Lucien",
        dueDate: "2026-09-16",
        tagIds: ["devis"],
      },
      nadia,
      new Date("2026-09-12T10:05:00.000Z"),
    ).payload;

    expect(assigned.entries[0]).toMatchObject({
      status: "ASSIGNED",
      assigneeName: "Lucien",
      dueDate: "2026-09-16",
      rawText: "Martin devis dressing",
    });
  });

  it("allows Voir plus tard only after the entry has reached attention and keeps its reason", () => {
    const initial = createInitialEntriesPayload();
    const createdAt = new Date("2026-09-07T08:00:00.000Z");
    const created = applyEntriesMutation(
      initial,
      {
        action: "create",
        rawText: "Appeler le client Durand",
        priority: "NORMAL",
        tagIds: ["contact"],
      },
      lucien,
      createdAt,
    ).payload;
    const entry = created.entries[0];
    const attentionDate = addFrenchBusinessHours(createdAt, 48);

    expect(isQualificationAttentionDue(entry, new Date(attentionDate.getTime() - 1))).toBe(false);
    expect(isQualificationAttentionDue(entry, attentionDate)).toBe(true);

    const snoozed = applyEntriesMutation(
      created,
      {
        action: "snooze",
        entryId: entry.id,
        untilDate: "2026-09-15",
        reason: "Attendre le retour du client",
      },
      nadia,
      attentionDate,
    ).payload;

    expect(snoozed.entries[0].snoozedUntilDate).toBe("2026-09-15");
    expect(snoozed.entries[0].history.at(-1)?.summary).toContain(
      "Attendre le retour du client",
    );
  });
});
