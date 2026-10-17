import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload, parsePlanningPayload } from "../src/lib/planning/domain";
import {
  applyWeeklyBoardEntry,
  weeklyBoardEntrySchema,
  weeklyChantierHours,
} from "../src/lib/planning/weekly-board";
import { frenchNationalPublicHolidayLabels, frenchNationalPublicHolidayIds } from "../src/lib/planning/capacity";

const personId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const chantierId = "33333333-3333-4333-8333-333333333333";
const chantier = [{ id: chantierId, name: "Pralus Chambéry" }];
const week = "2026-W43";
const date = "2026-10-19";
const people = new Set([personId]);

describe("multiple weekly entries per person and day", () => {
  it("saves independent BE/Atelier/Pose and free-text lines without adding grand-planning hours", () => {
    const source = createInitialPlanningPayload();
    source.macroAllocations.push({ chantierId, week, activity: "INSTALL", hours: 24 });
    const first = applyWeeklyBoardEntry(source, {
      action: "saveDailyEntry", week, userId: personId, date,
      label: "Pralus Chambéry", activity: "INSTALL",
    }, people, chantier);
    const second = applyWeeklyBoardEntry(first, {
      action: "saveDailyEntry", week, userId: personId, date,
      label: "Préparation débit", activity: "WORKSHOP",
    }, people, chantier);
    const third = applyWeeklyBoardEntry(second, {
      action: "saveDailyEntry", week, userId: personId, date,
      label: "Réunion interne", activity: "NOTE",
    }, people, chantier);
    expect(third.dailyAssignments).toHaveLength(3);
    expect(third.dailyAssignments.map((row) => row.activity)).toEqual(["INSTALL", "WORKSHOP", "NOTE"]);
    expect(third.dailyAssignments[0].chantierId).toBe(chantierId);
    expect(third.dailyAssignments[1].chantierId).toBeNull();
    expect(third.dailyAssignments.every((row) => !!row.id)).toBe(true);
    expect(third.macroAllocations).toEqual(source.macroAllocations);
    expect(source.dailyAssignments).toEqual([]);
  });

  it("edits or deletes only the selected line, never other lines in the day", () => {
    let payload = createInitialPlanningPayload();
    for (const label of ["A", "B", "C"]) {
      payload = applyWeeklyBoardEntry(payload, {
        action: "saveDailyEntry", week, userId: personId, date,
        label, activity: "BE",
      }, people, chantier);
    }
    const target = payload.dailyAssignments[1].id!;
    const updated = applyWeeklyBoardEntry(payload, {
      action: "saveDailyEntry", week, userId: personId, date,
      id: target, label: "B actualisé", activity: "WORKSHOP",
    }, people, chantier);
    expect(updated.dailyAssignments.map((row) => row.label)).toEqual(["A", "B actualisé", "C"]);
    const deleted = applyWeeklyBoardEntry(updated, {
      action: "deleteDailyEntry", week, userId: personId, date, id: target,
    }, people, chantier);
    expect(deleted.dailyAssignments.map((row) => row.label)).toEqual(["A", "C"]);
    expect(updated.dailyAssignments).toHaveLength(3);
  });

  it("reads old single-entry records as notes and lets the user upgrade or delete them", () => {
    const legacy = parsePlanningPayload({
      ...createInitialPlanningPayload(),
      dailyAssignments: [{ userId: personId, date, chantierId, label: "Pralus Chambéry" }],
    });
    expect(legacy.dailyAssignments[0]).toMatchObject({ activity: "NOTE", id: undefined });
    const upgraded = applyWeeklyBoardEntry(legacy, {
      action: "saveDailyEntry", week, userId: personId, date,
      legacy: true, activity: "INSTALL", label: "Pralus Chambéry",
    }, people, chantier);
    expect(upgraded.dailyAssignments).toHaveLength(1);
    expect(upgraded.dailyAssignments[0].id).toBeTruthy();
    const deleted = applyWeeklyBoardEntry(legacy, {
      action: "deleteDailyEntry", week, userId: personId, date, legacy: true,
    }, people, chantier);
    expect(deleted.dailyAssignments).toEqual([]);
  });

  it("rejects invalid week dates, inactive staff and cross-person edits", () => {
    const original = applyWeeklyBoardEntry(createInitialPlanningPayload(), {
      action: "saveDailyEntry", week, userId: personId, date,
      label: "A", activity: "BE",
    }, people, chantier);
    const id = original.dailyAssignments[0].id!;
    expect(() => applyWeeklyBoardEntry(original, {
      action: "saveDailyEntry", week, userId: otherId, date, label: "B", activity: "NOTE",
    }, people, chantier)).toThrow("PLANNING_USER_NOT_ACTIVE");
    expect(() => applyWeeklyBoardEntry(original, {
      action: "saveDailyEntry", week, userId: personId, date: "2026-10-24",
      label: "B", activity: "NOTE",
    }, people, chantier)).toThrow("PLANNING_DAY_OUTSIDE_WEEK");
    expect(() => applyWeeklyBoardEntry(original, {
      action: "saveDailyEntry", week, userId: otherId, date, id,
      label: "B", activity: "NOTE",
    }, new Set([personId, otherId]), chantier)).toThrow("PLANNING_DAILY_TARGET_INVALID");
    expect(() => weeklyBoardEntrySchema.parse({
      action: "saveDailyEntry", week, userId: personId, date,
      label: "B", activity: "WRONG",
    })).toThrow();
    expect(original.dailyAssignments).toHaveLength(1);
  });

  it("extracts chantier-by-chantier weekly activity hours and filters zero rows", () => {
    const rows = [
      { activities: [
        { activity: "BE" as const, weeklyHours: { [week]: 5 } },
        { activity: "WORKSHOP" as const, weeklyHours: { [week]: 20 } },
        { activity: "INSTALL" as const, weeklyHours: { [week]: 30 } },
      ] },
      { activities: [{ activity: "BE" as const, weeklyHours: {} }] },
    ];
    const lines = weeklyChantierHours(rows, week, "firm", (index) => ({
      id: String(index), name: ["Pralus Chambéry", "Autre"][index],
    }));
    expect(lines).toEqual([{
      id: "0", name: "Pralus Chambéry", category: "firm",
      be: 5, workshop: 20, install: 30, total: 55,
    }]);
  });

  it("marks national holidays across the December-to-January week", () => {
    const holidays = frenchNationalPublicHolidayLabels(2027);
    expect(holidays.get("2027-01-01")).toBe("Jour de l'An");
    expect(frenchNationalPublicHolidayIds(2027).has("2027-01-01")).toBe(true);
    expect(frenchNationalPublicHolidayLabels(2026).get("2026-11-11")).toBe("Armistice");
  });
});
