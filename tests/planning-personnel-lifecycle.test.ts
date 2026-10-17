import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import {
  applyPlanningStaffMutation,
  effectivePlanningPeople,
  personPresentOnDate,
} from "../src/lib/planning/personnel";
import {
  buildWeeklyCapacityIndicators,
  NEW_STAFF_WEEKLY_SCHEDULE,
} from "../src/lib/planning/capacity";
import { applyWeeklyBoardPaste, weeklyBoardPasteSchema } from "../src/lib/planning/weekly-board";

const personAccount = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const accounts = [{ id: personAccount, displayName: "Compte existant", isActive: true }];
const active = new Set([personAccount]);
const week = "2026-W43";
const workDate = "2026-10-19";

function member() {
  const first = applyPlanningStaffMutation(
    createInitialPlanningPayload(),
    {
      action: "saveStaff",
      firstName: "Alex",
      lastName: "Martin",
    },
    active,
  );
  const staffId = first.staff[0].id;
  const counted = {
    ...first,
    peopleCapacity: first.peopleCapacity.map((person) =>
      person.userId === staffId ? { ...person, countsInMacroCapacity: true } : person,
    ),
  };
  return { staffId, counted };
}

describe("staff lifecycle, notice and concealment", () => {
  it("keeps an existing permanent employee until the inclusive end date, and adjusts weekly capacity day by day", () => {
    const { counted, staffId } = member();
    expect(counted.staff[0].endDate).toBeNull();
    const ended = applyPlanningStaffMutation(
      counted,
      {
        action: "setStaffEndDate",
        id: staffId,
        endDate: "2026-10-21",
      },
      active,
    );
    expect(ended.staff[0].endDate).toBe("2026-10-21");
    const [person] = effectivePlanningPeople(ended, accounts).filter((p) => p.kind === "staff");
    expect(personPresentOnDate(person, "2026-10-21")).toBe(true);
    expect(personPresentOnDate(person, "2026-10-22")).toBe(false);
    const weeks = buildWeeklyCapacityIndicators(
      ["2026-W42", "2026-W43", "2026-W44"],
      [person],
      new Map(),
    );
    expect(weeks.map((w) => w.totalCapacityHours)).toEqual([38.5, 25.5, 0]);
    const extended = applyPlanningStaffMutation(
      ended,
      {
        action: "setStaffEndDate",
        id: staffId,
        endDate: "2026-10-30",
      },
      active,
    );
    expect(
      effectivePlanningPeople(extended, accounts).find((p) => p.userId === staffId)?.endDate,
    ).toBe("2026-10-30");
    const permanentAgain = applyPlanningStaffMutation(
      extended,
      {
        action: "setStaffEndDate",
        id: staffId,
        endDate: null,
      },
      active,
    );
    expect(permanentAgain.staff[0].endDate).toBeNull();
    expect(counted.staff[0].endDate).toBeNull();
    expect(NEW_STAFF_WEEKLY_SCHEDULE.friday).toBe(4.5);
  });

  it("deactivates and reactivates without erasing old assignments or the staff ID", () => {
    const { counted, staffId } = member();
    counted.dailyAssignments.push({
      id: crypto.randomUUID(),
      userId: staffId,
      date: workDate,
      label: "Chantier test",
      chantierId: null,
      activity: "INSTALL",
    });
    const inactive = applyPlanningStaffMutation(
      counted,
      {
        action: "deactivateStaff",
        id: staffId,
      },
      active,
    );
    expect(inactive.staff[0].inactiveSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(inactive.dailyAssignments).toEqual(counted.dailyAssignments);
    expect(
      buildWeeklyCapacityIndicators(
        ["2027-W01"],
        effectivePlanningPeople(inactive, accounts).filter((p) => p.kind === "staff"),
        new Map(),
      )[0].totalCapacityHours,
    ).toBe(0);
    const restored = applyPlanningStaffMutation(
      inactive,
      {
        action: "reactivateStaff",
        id: staffId,
      },
      active,
    );
    expect(restored.staff[0].inactiveSince).toBeNull();
    expect(restored.staff[0].id).toBe(staffId);
    expect(restored.dailyAssignments).toHaveLength(1);
  });

  it("hides people including legacy accounts only from the small board, never from capacity", () => {
    const { counted, staffId } = member();
    const hidden = applyPlanningStaffMutation(
      counted,
      {
        action: "setPersonHidden",
        id: staffId,
        hidden: true,
      },
      active,
    );
    const alsoHidden = applyPlanningStaffMutation(
      hidden,
      {
        action: "setPersonHidden",
        id: personAccount,
        hidden: true,
      },
      active,
    );
    expect(effectivePlanningPeople(alsoHidden, accounts).every((p) => p.hiddenInWeeklyBoard)).toBe(
      true,
    );
    expect(
      effectivePlanningPeople(alsoHidden, accounts).filter((p) => p.countsInMacroCapacity),
    ).toHaveLength(1);
    const visible = applyPlanningStaffMutation(
      alsoHidden,
      {
        action: "setPersonHidden",
        id: staffId,
        hidden: false,
      },
      active,
    );
    expect(visible.hiddenPersonIds).toEqual([personAccount]);
  });

  it("only permanently deletes records without history or linked accounts", () => {
    const { counted, staffId } = member();
    const removed = applyPlanningStaffMutation(
      counted,
      { action: "deleteStaff", id: staffId },
      active,
    );
    expect(removed.staff).toHaveLength(0);
    expect(removed.peopleCapacity).toHaveLength(0);
    const historic = {
      ...counted,
      dailyAssignments: [
        {
          id: crypto.randomUUID(),
          userId: staffId,
          date: workDate,
          label: "Atelier",
          chantierId: null,
          activity: "WORKSHOP" as const,
        },
      ],
    };
    expect(() =>
      applyPlanningStaffMutation(
        historic,
        {
          action: "deleteStaff",
          id: staffId,
        },
        active,
      ),
    ).toThrow("PLANNING_STAFF_HAS_HISTORY");
    const linked = applyPlanningStaffMutation(
      counted,
      {
        action: "linkStaffAccount",
        id: staffId,
        linkedUserId: personAccount,
      },
      active,
    );
    expect(() =>
      applyPlanningStaffMutation(
        linked,
        {
          action: "deleteStaff",
          id: staffId,
        },
        active,
      ),
    ).toThrow("PLANNING_STAFF_HAS_HISTORY");
    expect(counted.staff).toHaveLength(1);
  });
});

describe("copy and paste whole staff days", () => {
  const entries = [
    { label: "Pralus Chambéry", activity: "INSTALL" as const },
    { label: "Préparation atelier", activity: "WORKSHOP" as const },
    { label: "Point hebdo", activity: "NOTE" as const },
  ];
  const sites = [{ id: other, name: "Pralus Chambéry" }];
  it("appends multiple labels and activity colors in one atomic saved batch", () => {
    const source = createInitialPlanningPayload();
    source.dailyAssignments = [
      {
        id: crypto.randomUUID(),
        userId: personAccount,
        date: workDate,
        chantierId: null,
        label: "Déjà prévu",
        activity: "BE",
      },
    ];
    const input = weeklyBoardPasteSchema.parse({
      action: "pasteDailyEntries",
      week,
      userId: personAccount,
      date: workDate,
      entries,
    });
    const next = applyWeeklyBoardPaste(source, input, active, sites);
    expect(next.dailyAssignments.map((row) => row.label)).toEqual([
      "Déjà prévu",
      "Pralus Chambéry",
      "Préparation atelier",
      "Point hebdo",
    ]);
    expect(next.dailyAssignments.slice(1).map((row) => row.activity)).toEqual([
      "INSTALL",
      "WORKSHOP",
      "NOTE",
    ]);
    expect(next.dailyAssignments[1].chantierId).toBe(other);
    expect(new Set(next.dailyAssignments.map((row) => row.id)).size).toBe(4);
    expect(source.dailyAssignments).toHaveLength(1);
  });
  it("rejects excessive cells, weekends, invalid entries and inactive people with no partial writes", () => {
    const source = createInitialPlanningPayload();
    const base = {
      action: "pasteDailyEntries" as const,
      week,
      userId: personAccount,
      date: workDate,
      entries,
    };
    expect(() => applyWeeklyBoardPaste(source, { ...base, userId: other }, active, sites)).toThrow(
      "PLANNING_USER_NOT_ACTIVE",
    );
    expect(() =>
      applyWeeklyBoardPaste(source, { ...base, date: "2026-10-24" }, active, sites),
    ).toThrow("PLANNING_DAY_OUTSIDE_WEEK");
    expect(() => weeklyBoardPasteSchema.parse({ ...base, entries: [] })).toThrow();
    const overflowing = {
      ...source,
      dailyAssignments: Array.from({ length: 19 }, (_, index) => ({
        id: crypto.randomUUID(),
        userId: personAccount,
        date: workDate,
        label: "N" + index,
        activity: "NOTE" as const,
        chantierId: null,
      })),
    };
    expect(() => applyWeeklyBoardPaste(overflowing, base, active, sites)).toThrow(
      "PLANNING_DAILY_LIMIT",
    );
    expect(overflowing.dailyAssignments).toHaveLength(19);
  });
});
