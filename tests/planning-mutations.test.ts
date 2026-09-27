import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import {
  applyPlanningAbsenceMutation,
  applyPlanningDeleteAbsenceMutation,
  applyPlanningFullWeekAbsenceMutation,
  applyPlanningMacroMutation,
  applyPlanningPersonCapacityMutation,
} from "../src/lib/planning/mutations";

const chantierId = "11111111-1111-4111-8111-111111111111";
const active = new Set([chantierId]);

describe("grand planning mutations", () => {
  it("sets and replaces weekly hours without duplicating a cell", () => {
    const first = applyPlanningMacroMutation(
      createInitialPlanningPayload(),
      {
        action: "setMacroHours",
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 20,
      },
      active,
    );
    const second = applyPlanningMacroMutation(
      first,
      {
        action: "setMacroHours",
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 10,
      },
      active,
    );

    expect(second.macroAllocations).toEqual([
      {
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 10,
      },
    ]);
  });

  it("removes the allocation when a cell returns to zero", () => {
    const filled = applyPlanningMacroMutation(
      createInitialPlanningPayload(),
      {
        action: "setMacroHours",
        chantierId,
        activity: "BE",
        week: "2026-W40",
        hours: 8,
      },
      active,
    );

    const cleared = applyPlanningMacroMutation(
      filled,
      {
        action: "setMacroHours",
        chantierId,
        activity: "BE",
        week: "2026-W40",
        hours: 0,
      },
      active,
    );

    expect(cleared.macroAllocations).toEqual([]);
  });

  it("does not impose the chantier planned volume on direct weekly input", () => {
    const result = applyPlanningMacroMutation(
      createInitialPlanningPayload(),
      {
        action: "setMacroHours",
        chantierId,
        activity: "INSTALL",
        week: "2026-W40",
        hours: 500,
      },
      active,
    );

    expect(result.macroAllocations[0]?.hours).toBe(500);
  });

  it("refuses to plan a closed chantier", () => {
    expect(() =>
      applyPlanningMacroMutation(
        createInitialPlanningPayload(),
        {
          action: "setMacroHours",
          chantierId,
          activity: "BE",
          week: "2026-W40",
          hours: 4,
        },
        new Set(),
      ),
    ).toThrow("PLANNING_CHANTIER_NOT_ACTIVE");
  });
});

describe("planning person capacity mutations", () => {
  const userId = "33333333-3333-4333-8333-333333333333";

  it("stores inclusion and the individual weekly schedule", () => {
    const result = applyPlanningPersonCapacityMutation(
      createInitialPlanningPayload(),
      {
        action: "setPersonCapacity",
        userId,
        countsInMacroCapacity: true,
        weeklySchedule: {
          monday: 8,
          tuesday: 8,
          wednesday: 8,
          thursday: 8,
          friday: 7,
          saturday: 0,
          sunday: 0,
        },
      },
      new Set([userId]),
    );

    expect(result.peopleCapacity).toEqual([
      {
        userId,
        countsInMacroCapacity: true,
        weeklySchedule: {
          monday: 8,
          tuesday: 8,
          wednesday: 8,
          thursday: 8,
          friday: 7,
          saturday: 0,
          sunday: 0,
        },
      },
    ]);
  });

  it("refuses capacity changes for an inactive user", () => {
    expect(() =>
      applyPlanningPersonCapacityMutation(
        createInitialPlanningPayload(),
        {
          action: "setPersonCapacity",
          userId,
          countsInMacroCapacity: true,
          weeklySchedule: {
            monday: 8,
            tuesday: 8,
            wednesday: 8,
            thursday: 8,
            friday: 7,
            saturday: 0,
            sunday: 0,
          },
        },
        new Set(),
      ),
    ).toThrow("PLANNING_USER_NOT_ACTIVE");
  });
});

describe("planning absence mutations", () => {
  const userId = "33333333-3333-4333-8333-333333333333";
  const activeUsers = new Set([userId]);

  it("adds and replaces an absence on the same person and date", () => {
    const first = applyPlanningAbsenceMutation(
      createInitialPlanningPayload(),
      {
        action: "setAbsence",
        userId,
        type: "VACATION",
        date: "2026-09-28",
        hours: 4,
      },
      activeUsers,
    );

    const second = applyPlanningAbsenceMutation(
      first,
      {
        action: "setAbsence",
        userId,
        type: "SICK",
        date: "2026-09-28",
        hours: 7.8,
      },
      activeUsers,
    );

    expect(second.absences).toHaveLength(1);
    expect(second.absences[0]).toMatchObject({
      userId,
      type: "SICK",
      date: "2026-09-28",
      hours: 7.8,
    });
  });

  it("creates a full working week without weekend or public-holiday rows", () => {
    const result = applyPlanningFullWeekAbsenceMutation(
      createInitialPlanningPayload(),
      {
        action: "setFullWeekAbsence",
        userId,
        type: "VACATION",
        week: "2026-W20",
      },
      activeUsers,
    );

    expect(result.absences.map((absence) => absence.date)).toEqual([
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-15",
    ]);
    expect(result.absences.every((absence) => absence.hours === 7.8)).toBe(true);
  });

  it("deletes an absence", () => {
    const added = applyPlanningAbsenceMutation(
      createInitialPlanningPayload(),
      {
        action: "setAbsence",
        userId,
        type: "OTHER",
        date: "2026-09-28",
        hours: 2,
      },
      activeUsers,
    );
    const absenceId = added.absences[0]?.id;
    expect(absenceId).toBeTruthy();

    const deleted = applyPlanningDeleteAbsenceMutation(added, {
      action: "deleteAbsence",
      absenceId: absenceId!,
    });
    expect(deleted.absences).toEqual([]);
  });

  it("refuses an absence for an inactive user", () => {
    expect(() =>
      applyPlanningAbsenceMutation(
        createInitialPlanningPayload(),
        {
          action: "setAbsence",
          userId,
          type: "OTHER",
          date: "2026-09-28",
          hours: 2,
        },
        new Set(),
      ),
    ).toThrow("PLANNING_USER_NOT_ACTIVE");
  });
});
