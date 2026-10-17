import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload, parsePlanningPayload } from "../src/lib/planning/domain";
import {
  applyActualHoursRow,
  actualHoursByActivity,
  actualHoursRowSchema,
  actualHoursWeekSchema,
} from "../src/lib/planning/actual-hours";

const chantierId = "11111111-1111-4111-8111-111111111111";
const secondSiteId = "22222222-2222-4222-8222-222222222222";
const personId = "33333333-3333-4333-8333-333333333333";
const colleagueId = "44444444-4444-4444-8444-444444444444";
const sites = new Set([chantierId, secondSiteId]);
const people = new Set([personId, colleagueId]);
const input = {
  action: "saveActualHoursRow" as const,
  chantierId,
  userId: personId,
  week: "2026-W40",
  be: 2.5,
  workshop: 18,
  install: 12,
};

describe("weekly actual hours register", () => {
  it("registers three activities atomically for staff without a login account", () => {
    const source = createInitialPlanningPayload();
    const stored = applyActualHoursRow(source, input, sites, people);
    expect(stored.actualHours).toEqual([
      { chantierId, userId: personId, week: input.week, activity: "BE", hours: 2.5 },
      { chantierId, userId: personId, week: input.week, activity: "WORKSHOP", hours: 18 },
      { chantierId, userId: personId, week: input.week, activity: "INSTALL", hours: 12 },
    ]);
    expect(source.actualHours).toEqual([]);
    expect(actualHoursByActivity(stored.actualHours)).toEqual({
      be: 2.5, workshop: 18, install: 12,
    });
  });

  it("corrects the same person/week/site without duplicating previous hours", () => {
    const initial = applyActualHoursRow(createInitialPlanningPayload(), input, sites, people);
    const corrected = applyActualHoursRow(initial, { ...input, be: 0, workshop: 10, install: 15 }, sites, people);
    expect(corrected.actualHours).toHaveLength(2);
    expect(actualHoursByActivity(corrected.actualHours)).toEqual({
      be: 0, workshop: 10, install: 15,
    });
    const cleared = applyActualHoursRow(corrected, { ...input, be: 0, workshop: 0, install: 0 }, sites, people);
    expect(cleared.actualHours).toHaveLength(0);
  });

  it("preserves other people, chantiers and weeks", () => {
    const initial = applyActualHoursRow(createInitialPlanningPayload(), input, sites, people);
    const otherSite = applyActualHoursRow(initial, {
      ...input, chantierId: secondSiteId, workshop: 1, be: 0, install: 0,
    }, sites, people);
    const otherPerson = applyActualHoursRow(otherSite, {
      ...input, userId: colleagueId, be: 4, workshop: 0, install: 0,
    }, sites, people);
    const otherWeek = applyActualHoursRow(otherPerson, {
      ...input, week: "2026-W39", be: 1, workshop: 0, install: 0,
    }, sites, people);
    expect(otherWeek.actualHours).toHaveLength(6);
    expect(otherWeek.actualHours.filter((row) => row.week === "2026-W40")).toHaveLength(5);
    expect(otherWeek.actualHours.filter((row) => row.week === "2026-W39")).toHaveLength(1);
    expect(parsePlanningPayload(otherWeek)).toEqual(otherWeek);
  });

  it("enforces a per-person weekly maximum across all projects", () => {
    const first = applyActualHoursRow(createInitialPlanningPayload(), {
      ...input, be: 0, workshop: 100, install: 0,
    }, sites, people);
    expect(() => applyActualHoursRow(first, {
      ...input, chantierId: secondSiteId, be: 0, workshop: 69, install: 0,
    }, sites, people)).toThrow("PLANNING_ACTUAL_PERSON_WEEK_TOO_HIGH");
    expect(first.actualHours).toHaveLength(1);
    expect(() => actualHoursRowSchema.parse({ ...input, workshop: -1 })).toThrow();
    expect(() => actualHoursRowSchema.parse({ ...input, workshop: Number.NaN })).toThrow();
    expect(() => actualHoursRowSchema.parse({ ...input, workshop: 200 })).toThrow();
    expect(() => actualHoursRowSchema.parse({ ...input, workshop: 100, install: 100 })).toThrow();
  });

  it("rejects unknown people, sites and invalid ISO weeks", () => {
    expect(() => applyActualHoursRow(
      createInitialPlanningPayload(), input, new Set(), people,
    )).toThrow("PLANNING_CHANTIER_NOT_FOUND");
    expect(() => applyActualHoursRow(
      createInitialPlanningPayload(), input, sites, new Set(),
    )).toThrow("PLANNING_PERSON_NOT_FOUND");
    expect(actualHoursWeekSchema.safeParse("2026-W54").success).toBe(false);
    expect(actualHoursWeekSchema.safeParse("2027-W53").success).toBe(false);
    expect(actualHoursWeekSchema.safeParse("2026-W40").success).toBe(true);
  });
});
