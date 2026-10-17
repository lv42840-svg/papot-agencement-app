import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload, parsePlanningPayload } from "../src/lib/planning/domain";
import { applyPlanningStaffMutation, effectivePlanningPeople } from "../src/lib/planning/personnel";
import {
  applyPlanningAbsenceMutation,
  applyPlanningPersonCapacityMutation,
} from "../src/lib/planning/mutations";
import {
  buildWeeklyCapacityIndicators,
  DEFAULT_WEEKLY_SCHEDULE,
  NEW_STAFF_WEEKLY_SCHEDULE,
  suggestedAbsenceHoursForDate,
  weeklyScheduleHours,
} from "../src/lib/planning/capacity";

const accountId = "11111111-1111-4111-8111-111111111111";
const secondAccountId = "22222222-2222-4222-8222-222222222222";
const accounts = [
  { id: accountId, displayName: "Compte Lucien", isActive: true },
  { id: secondAccountId, displayName: "Compte Nadia", isActive: true },
];
const active = new Set(accounts.map((account) => account.id));
function addStaff() {
  return applyPlanningStaffMutation(
    createInitialPlanningPayload(),
    { action: "saveStaff", firstName: "Alix", lastName: "Martin" },
    active,
  );
}

describe("planning independent personnel", () => {
  it("keeps legacy users and creates independent named personnel without a login", () => {
    const base = parsePlanningPayload({ ...createInitialPlanningPayload(), staff: undefined });
    expect(base.staff).toEqual([]);
    const saved = addStaff();
    const personnel = effectivePlanningPeople(saved, accounts);
    expect(personnel).toHaveLength(3);
    expect(personnel[2]).toMatchObject({
      displayName: "Alix Martin",
      kind: "staff",
      linkedUserId: null,
      countsInMacroCapacity: false,
      weeklySchedule: NEW_STAFF_WEEKLY_SCHEDULE,
    });
    expect(saved.staff[0].id).not.toBe(accountId);
  });

  it("gives newly created staff exactly 38.5 weekly hours without changing legacy accounts", () => {
    const created = addStaff();
    const personId = created.staff[0].id;
    const savedSchedule = created.peopleCapacity.find((entry) => entry.userId === personId);
    expect(savedSchedule?.weeklySchedule).toEqual({
      monday: 8.5,
      tuesday: 8.5,
      wednesday: 8.5,
      thursday: 8.5,
      friday: 4.5,
      saturday: 0,
      sunday: 0,
    });
    expect(savedSchedule?.countsInMacroCapacity).toBe(false);
    expect(weeklyScheduleHours(savedSchedule!.weeklySchedule)).toBe(38.5);
    expect(effectivePlanningPeople(created, accounts)[0].weeklySchedule).toEqual(
      DEFAULT_WEEKLY_SCHEDULE,
    );
  });

  it("proposes absence hours for the selected date, including Friday, weekends and holidays", () => {
    const schedule = NEW_STAFF_WEEKLY_SCHEDULE;
    expect(suggestedAbsenceHoursForDate(schedule, "2026-10-19")).toBe(8.5);
    expect(suggestedAbsenceHoursForDate(schedule, "2026-10-23")).toBe(4.5);
    expect(suggestedAbsenceHoursForDate(schedule, "2026-10-24")).toBe(0);
    expect(suggestedAbsenceHoursForDate(schedule, "2026-11-11")).toBe(0);
    expect(suggestedAbsenceHoursForDate(schedule, "2027-01-01")).toBe(0);
    expect(suggestedAbsenceHoursForDate(schedule, "2026-13-51")).toBe(0);
    expect(suggestedAbsenceHoursForDate(schedule, "")).toBe(0);
  });

  it("allows independent staff to count toward capacity, with absence tracked by staff ID", () => {
    const saved = addStaff();
    const id = saved.staff[0].id;
    const counted = applyPlanningPersonCapacityMutation(
      saved,
      {
        action: "setPersonCapacity",
        userId: id,
        countsInMacroCapacity: true,
        weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
      },
      new Set(effectivePlanningPeople(saved, accounts).map((person) => person.userId)),
    );
    const absent = applyPlanningAbsenceMutation(
      counted,
      {
        action: "setAbsence",
        userId: id,
        type: "VACATION",
        date: "2026-10-19",
        hours: 7.8,
      },
      new Set(effectivePlanningPeople(counted, accounts).map((person) => person.userId)),
    );
    const indicators = buildWeeklyCapacityIndicators(
      ["2026-W43"],
      effectivePlanningPeople(absent, accounts),
      new Map(),
      absent.absences,
    );
    expect(indicators[0].totalCapacityHours).toBeCloseTo(31.2);
    expect(absent.absences[0].userId).toBe(id);
  });

  it("links a staff member to an existing account without double-counting or losing the ID", () => {
    const created = addStaff();
    const personId = created.staff[0].id;
    const withLegacy = applyPlanningPersonCapacityMutation(
      created,
      {
        action: "setPersonCapacity",
        userId: accountId,
        countsInMacroCapacity: true,
        weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
      },
      active,
    );
    const absent = applyPlanningAbsenceMutation(
      withLegacy,
      {
        action: "setAbsence",
        userId: accountId,
        type: "VACATION",
        date: "2026-10-19",
        hours: 7.8,
      },
      active,
    );
    const linked = applyPlanningStaffMutation(
      absent,
      { action: "linkStaffAccount", id: personId, linkedUserId: accountId },
      active,
    );
    const people = effectivePlanningPeople(linked, accounts);
    expect(people).toHaveLength(2);
    expect(people.filter((person) => person.linkedUserId === accountId)).toHaveLength(1);
    expect(people.find((person) => person.userId === personId)?.countsInMacroCapacity).toBe(true);
    expect(linked.absences[0].userId).toBe(personId);
    expect(linked.peopleCapacity[0].userId).toBe(personId);
    expect(linked.staff[0].id).toBe(personId);
    expect(linked.peopleCapacity).toHaveLength(1);
    expect(linked.peopleCapacity[0].weeklySchedule).toEqual(DEFAULT_WEEKLY_SCHEDULE);
  });

  it("supports renaming and unlinking while keeping staff schedules and absences", () => {
    const created = addStaff();
    const id = created.staff[0].id;
    const linked = applyPlanningStaffMutation(
      created,
      {
        action: "linkStaffAccount",
        id,
        linkedUserId: accountId,
      },
      active,
    );
    const renamed = applyPlanningStaffMutation(
      linked,
      {
        action: "saveStaff",
        id,
        firstName: "Alex",
        lastName: "Martin",
      },
      active,
    );
    const unlinked = applyPlanningStaffMutation(
      renamed,
      {
        action: "linkStaffAccount",
        id,
        linkedUserId: null,
      },
      active,
    );
    expect(unlinked.staff[0]).toMatchObject({
      id,
      firstName: "Alex",
      lastName: "Martin",
      linkedUserId: null,
    });
    expect(effectivePlanningPeople(unlinked, accounts)).toHaveLength(3);
  });

  it("refuses a duplicate account link, a disabled account, and missing staff", () => {
    const first = addStaff();
    const second = applyPlanningStaffMutation(
      first,
      { action: "saveStaff", firstName: "Sam", lastName: "Leroy" },
      active,
    );
    const linked = applyPlanningStaffMutation(
      second,
      {
        action: "linkStaffAccount",
        id: first.staff[0].id,
        linkedUserId: accountId,
      },
      active,
    );
    expect(() =>
      applyPlanningStaffMutation(
        linked,
        {
          action: "linkStaffAccount",
          id: second.staff[1].id,
          linkedUserId: accountId,
        },
        active,
      ),
    ).toThrow("PLANNING_ACCOUNT_ALREADY_LINKED");
    expect(() =>
      applyPlanningStaffMutation(
        first,
        {
          action: "linkStaffAccount",
          id: first.staff[0].id,
          linkedUserId: secondAccountId,
        },
        new Set([accountId]),
      ),
    ).toThrow("PLANNING_ACCOUNT_NOT_ACTIVE");
    expect(() =>
      applyPlanningStaffMutation(
        first,
        {
          action: "saveStaff",
          id: accountId,
          firstName: "X",
          lastName: "Y",
        },
        active,
      ),
    ).toThrow("PLANNING_STAFF_NOT_FOUND");
  });

  it("blocks linking when both existing schedules conflict, never silently drops absence data", () => {
    const created = addStaff();
    const personId = created.staff[0].id;
    const config = {
      action: "setPersonCapacity" as const,
      countsInMacroCapacity: true,
      weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
    };
    const staffScheduled = applyPlanningPersonCapacityMutation(
      created,
      {
        ...config,
        userId: personId,
      },
      new Set([personId]),
    );
    const both = applyPlanningPersonCapacityMutation(
      staffScheduled,
      {
        ...config,
        userId: accountId,
      },
      active,
    );
    expect(() =>
      applyPlanningStaffMutation(
        both,
        {
          action: "linkStaffAccount",
          id: personId,
          linkedUserId: accountId,
        },
        active,
      ),
    ).toThrow("PLANNING_STAFF_CAPACITY_CONFLICT");
    expect(both.peopleCapacity).toHaveLength(2);
  });
});
