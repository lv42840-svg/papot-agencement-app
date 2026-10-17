import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload, parsePlanningPayload } from "../src/lib/planning/domain";
import {
  applyDailyAssignment,
  weekActivityHours,
  weeklyBoardAssignmentSchema,
  weeklyBoardWeekSchema,
  workingDaysOfWeek,
} from "../src/lib/planning/weekly-board";

const personId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const chantierId = "33333333-3333-4333-8333-333333333333";
const people = new Set([personId]);
const sites = [{ id: chantierId, name: "Pralus Chambéry" }];
const week = "2026-W43";

describe("weekly team board", () => {
  it("uses the five ISO weekdays and navigates 2026->2027 without mixing weeks", () => {
    expect(workingDaysOfWeek(week)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(workingDaysOfWeek("2026-W53")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(weeklyBoardWeekSchema.safeParse("2026-W54").success).toBe(false);
    expect(weeklyBoardWeekSchema.safeParse("2027-W53").success).toBe(false);
  });

  it("saves, renames and clears one person/day without changing grand planning hours", () => {
    const source = createInitialPlanningPayload();
    source.macroAllocations = [{ chantierId, activity: "INSTALL", week, hours: 25 }];
    const input = {
      action: "setDailyAssignment" as const,
      week,
      userId: personId,
      date: "2026-10-19",
      label: "Pralus Chambéry",
    };
    const first = applyDailyAssignment(source, input, people, sites);
    expect(first.dailyAssignments).toMatchObject([
      {
        userId: personId,
        date: "2026-10-19",
        chantierId,
        label: "Pralus Chambéry",
      },
    ]);
    const custom = applyDailyAssignment(
      first,
      { ...input, label: "Livraison atelier" },
      people,
      sites,
    );
    expect(custom.dailyAssignments).toMatchObject([
      {
        chantierId: null,
        label: "Livraison atelier",
      },
    ]);
    const empty = applyDailyAssignment(custom, { ...input, label: "" }, people, sites);
    expect(empty.dailyAssignments).toHaveLength(0);
    expect(empty.macroAllocations).toEqual(source.macroAllocations);
    expect(source.dailyAssignments).toHaveLength(0);
  });

  it("keeps two people on the same date independent", () => {
    const source = createInitialPlanningPayload();
    const a = applyDailyAssignment(
      source,
      {
        action: "setDailyAssignment",
        week,
        userId: personId,
        date: "2026-10-19",
        label: "Atelier",
      },
      new Set([personId, otherId]),
      sites,
    );
    const b = applyDailyAssignment(
      a,
      {
        action: "setDailyAssignment",
        week,
        userId: otherId,
        date: "2026-10-19",
        label: "Pose",
      },
      new Set([personId, otherId]),
      sites,
    );
    expect(b.dailyAssignments).toHaveLength(2);
  });

  it("refuses unknown staff, invalid dates, weekends and assignments outside the selected week", () => {
    const input = {
      action: "setDailyAssignment" as const,
      week,
      userId: personId,
      date: "2026-10-19",
      label: "Chantier",
    };
    const source = createInitialPlanningPayload();
    expect(() =>
      applyDailyAssignment(source, { ...input, userId: otherId }, people, sites),
    ).toThrow("PLANNING_USER_NOT_ACTIVE");
    expect(() =>
      applyDailyAssignment(source, { ...input, date: "2026-10-24" }, people, sites),
    ).toThrow("PLANNING_DAY_OUTSIDE_WEEK");
    expect(() =>
      applyDailyAssignment(source, { ...input, date: "2026-10-26" }, people, sites),
    ).toThrow("PLANNING_DAY_OUTSIDE_WEEK");
    expect(() => weeklyBoardAssignmentSchema.parse({ ...input, label: "x".repeat(161) })).toThrow();
    expect(source.dailyAssignments).toHaveLength(0);
  });

  it("reads the same firm and provisional BE/Atelier/Pose weekly cells as the grand planning", () => {
    const rows = [
      {
        activities: [
          { activity: "BE" as const, weeklyHours: { [week]: 10 } },
          { activity: "WORKSHOP" as const, weeklyHours: { [week]: 12.5 } },
          { activity: "INSTALL" as const, weeklyHours: { [week]: 15 } },
        ],
      },
      { activities: [{ activity: "INSTALL" as const, weeklyHours: { [week]: 8 } }] },
    ];
    expect(weekActivityHours(rows, week)).toEqual({
      be: 10,
      workshop: 12.5,
      install: 23,
      total: 45.5,
    });
    expect(weekActivityHours(rows, "2026-W44").total).toBe(0);
  });

  it("keeps day assignments when an existing PAPOT account is linked to a staff identity", async () => {
    const { applyPlanningStaffMutation } = await import("../src/lib/planning/personnel");
    const source = createInitialPlanningPayload();
    source.dailyAssignments = [
      {
        userId: personId,
        date: "2026-10-19",
        chantierId,
        label: "Pralus Chambéry",
        activity: "INSTALL",
      },
    ];
    const created = applyPlanningStaffMutation(
      source,
      {
        action: "saveStaff",
        firstName: "Alex",
        lastName: "Martin",
      },
      new Set([personId]),
    );
    const staffId = created.staff[0].id;
    const linked = applyPlanningStaffMutation(
      created,
      {
        action: "linkStaffAccount",
        id: staffId,
        linkedUserId: personId,
      },
      new Set([personId]),
    );
    expect(linked.dailyAssignments[0]).toMatchObject({ userId: staffId, label: "Pralus Chambéry" });
    expect(source.dailyAssignments[0].userId).toBe(personId);
  });

  it("parses legacy saved planning with no new daily assignment field", () => {
    const source = createInitialPlanningPayload();
    const legacy = { ...source, dailyAssignments: undefined };
    expect(parsePlanningPayload(legacy).dailyAssignments).toEqual([]);
  });
});
