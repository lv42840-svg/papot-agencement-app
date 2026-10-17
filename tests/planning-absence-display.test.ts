import { describe, expect, it } from "vitest";
import { groupPlanningAbsences, type DisplayAbsence } from "../src/lib/planning/absence-display";
import { buildWeeklyCapacityIndicators, NEW_STAFF_WEEKLY_SCHEDULE } from "../src/lib/planning/capacity";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import {
  applyPlanningAbsenceMutation,
  applyPlanningFullWeekAbsenceMutation,
  applyPlanningDeleteAbsenceBatchMutation,
  applyPlanningDeleteAbsenceMutation,
  planningMutationSchema,
} from "../src/lib/planning/mutations";

const personId = "11111111-1111-4111-8111-111111111111";
const people = [{
  userId: personId,
  countsInMacroCapacity: true,
  weeklySchedule: NEW_STAFF_WEEKLY_SCHEDULE,
}];
const active = new Set([personId]);

function newWeek() {
  const source = createInitialPlanningPayload();
  source.peopleCapacity = people;
  return applyPlanningFullWeekAbsenceMutation(source, {
    action: "setFullWeekAbsence",
    userId: personId,
    type: "VACATION",
    week: "2026-W43",
  }, active);
}

function display(absences: ReturnType<typeof newWeek>["absences"]): DisplayAbsence[] {
  return absences.map((absence) => ({
    ...absence, displayName: "Alix Martin", typeLabel: "Congés",
  }));
}

describe("weekly absences grouped by person", () => {
  it("stores five working-day absences for capacity but displays one week of 38.5 hours", () => {
    const saved = newWeek();
    expect(saved.absences).toHaveLength(5);
    expect(saved.absences.every((row) => row.weekGroupId === saved.absences[0].weekGroupId)).toBe(true);
    const groups = groupPlanningAbsences(display(saved.absences), people);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: "week", userId: personId, week: "2026-W43",
      hours: 38.5, days: 5,
    });
    expect(groups[0].absenceIds).toHaveLength(5);
    expect(buildWeeklyCapacityIndicators(["2026-W43"], people, new Map(), saved.absences)[0].totalCapacityHours).toBe(0);
  });

  it("recognizes older complete weeks that have no group IDs", () => {
    const legacy = display(newWeek().absences.map(({ weekGroupId: _unused, ...row }) => row));
    const groups = groupPlanningAbsences(legacy, people);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("week");
    expect(groups[0].hours).toBe(38.5);
  });

  it("keeps independent single days as their own lines", () => {
    const saved = newWeek();
    const oneDay = display([saved.absences[0]]);
    expect(groupPlanningAbsences(oneDay, people)).toHaveLength(1);
    expect(groupPlanningAbsences(oneDay, people)[0].kind).toBe("week");
    const manuallyRecorded = applyPlanningAbsenceMutation(
      createInitialPlanningPayload(),
      { action: "setAbsence", userId: personId, date: "2026-10-19", type: "VACATION", hours: 8.5 },
      active,
    );
    expect(groupPlanningAbsences(display(manuallyRecorded.absences), people)[0].kind).toBe("day");
  });

  it("keeps separate types and partial dates separate even during the same ISO week", () => {
    const source = createInitialPlanningPayload();
    source.peopleCapacity = people;
    const first = applyPlanningAbsenceMutation(source, {
      action: "setAbsence", userId: personId, date: "2026-10-19", type: "SICK", hours: 8.5,
    }, active);
    const second = applyPlanningAbsenceMutation(first, {
      action: "setAbsence", userId: personId, date: "2026-10-20", type: "VACATION", hours: 4,
    }, active);
    expect(groupPlanningAbsences(display(second.absences), people).map((row) => row.kind)).toEqual([
      "day", "day",
    ]);
  });

  it("deletes a whole displayed week in one transaction and restores capacity", () => {
    const source = newWeek();
    const ids = source.absences.map((absence) => absence.id);
    const input = planningMutationSchema.parse({ action: "deleteAbsenceBatch", absenceIds: ids });
    if (input.action !== "deleteAbsenceBatch") throw new Error("Wrong schema action");
    const result = applyPlanningDeleteAbsenceBatchMutation(source, input);
    expect(result.absences).toHaveLength(0);
    expect(source.absences).toHaveLength(5);
    expect(buildWeeklyCapacityIndicators(["2026-W43"], people, new Map(), result.absences)[0].totalCapacityHours).toBe(38.5);
  });

  it("refuses missing or mixed-person IDs without deleting any absence", () => {
    const source = newWeek();
    expect(() => applyPlanningDeleteAbsenceBatchMutation(source, {
      action: "deleteAbsenceBatch",
      absenceIds: [source.absences[0].id, "99999999-9999-4999-8999-999999999999"],
    })).toThrow("PLANNING_ABSENCE_NOT_FOUND");
    expect(() => applyPlanningDeleteAbsenceBatchMutation(source, {
      action: "deleteAbsenceBatch",
      absenceIds: [source.absences[0].id, source.absences[0].id],
    })).toThrow("PLANNING_ABSENCE_BATCH_DUPLICATE");
    expect(source.absences).toHaveLength(5);
  });

  it("editing or deleting a day dissolves its old week group rather than faking a complete week", () => {
    const source = newWeek();
    const modified = applyPlanningAbsenceMutation(source, {
      action: "setAbsence", id: source.absences[0].id, userId: personId,
      type: "SICK", date: source.absences[0].date, hours: 8.5,
    }, active);
    expect(modified.absences.every((row) => row.weekGroupId == null)).toBe(true);
    expect(groupPlanningAbsences(display(modified.absences), people)).toHaveLength(5);
    const removed = applyPlanningDeleteAbsenceMutation(source, {
      action: "deleteAbsence", absenceId: source.absences[0].id,
    });
    expect(groupPlanningAbsences(display(removed.absences), people)).toHaveLength(4);
  });
});
