import {
  DEFAULT_WEEKLY_SCHEDULE,
  NEW_STAFF_WEEKLY_SCHEDULE,
  type PlanningPersonCapacity,
} from "./capacity";
import { parsePlanningPayload, type PlanningPayload, type PlanningStaff } from "./domain";

export type PlanningAccount = { id: string; displayName: string; isActive: boolean };

export type PlanningVisiblePerson = PlanningPersonCapacity & {
  displayName: string;
  kind: "account" | "staff";
  firstName: string | null;
  lastName: string | null;
  linkedUserId: string | null;
  hiddenInWeeklyBoard: boolean;
  endDate: string | null;
  inactiveSince: string | null;
};

export function effectivePlanningPeople(
  payload: Pick<PlanningPayload, "staff" | "peopleCapacity" | "hiddenPersonIds">,
  accounts: readonly PlanningAccount[],
): PlanningVisiblePerson[] {
  const saved = new Map(payload.peopleCapacity.map((person) => [person.userId, person]));
  const linked = new Set(payload.staff.map((person) => person.linkedUserId).filter(Boolean));
  const hidden = new Set(payload.hiddenPersonIds);
  const legacy: PlanningVisiblePerson[] = accounts
    .filter((account) => account.isActive && !linked.has(account.id))
    .map((account) => ({
      ...(saved.get(account.id) ?? {
        userId: account.id,
        countsInMacroCapacity: false,
        weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
      }),
      displayName: account.displayName,
      kind: "account",
      firstName: null,
      lastName: null,
      linkedUserId: account.id,
      hiddenInWeeklyBoard: hidden.has(account.id),
      endDate: null,
      inactiveSince: null,
    }));
  const staff: PlanningVisiblePerson[] = payload.staff.map((person) => ({
    ...(saved.get(person.id) ?? {
      userId: person.id,
      countsInMacroCapacity: false,
      weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
    }),
    displayName: `${person.firstName} ${person.lastName}`,
    kind: "staff",
    firstName: person.firstName,
    lastName: person.lastName,
    linkedUserId: person.linkedUserId,
    hiddenInWeeklyBoard: hidden.has(person.id),
    endDate: person.endDate,
    inactiveSince: person.inactiveSince,
  }));
  return [...legacy, ...staff];
}

export function personPresentOnDate(
  person: Pick<PlanningVisiblePerson, "endDate" | "inactiveSince">,
  date: string,
): boolean {
  return (
    (!person.endDate || date <= person.endDate) &&
    (!person.inactiveSince || date < person.inactiveSince)
  );
}

export type PlanningStaffMutation =
  | { action: "saveStaff"; id?: string; firstName: string; lastName: string }
  | { action: "linkStaffAccount"; id: string; linkedUserId: string | null }
  | { action: "setPersonHidden"; id: string; hidden: boolean }
  | { action: "setStaffEndDate"; id: string; endDate: string | null }
  | { action: "deactivateStaff"; id: string }
  | { action: "reactivateStaff"; id: string }
  | { action: "deleteStaff"; id: string };

export function applyPlanningStaffMutation(
  source: PlanningPayload,
  input: PlanningStaffMutation,
  activeAccounts: ReadonlySet<string>,
): PlanningPayload {
  const payload = structuredClone(parsePlanningPayload(source));
  if (input.action === "saveStaff") {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      throw new Error("PLANNING_STAFF_NAME_INVALID");
    }
    if (input.id) {
      const person = payload.staff.find((candidate) => candidate.id === input.id);
      if (!person) throw new Error("PLANNING_STAFF_NOT_FOUND");
      person.firstName = firstName;
      person.lastName = lastName;
    } else {
      const personId = crypto.randomUUID();
      payload.staff.push({
        id: personId,
        firstName,
        lastName,
        linkedUserId: null,
        endDate: null,
        inactiveSince: null,
      });
      payload.peopleCapacity.push({
        userId: personId,
        countsInMacroCapacity: false,
        weeklySchedule: { ...NEW_STAFF_WEEKLY_SCHEDULE },
      });
    }
    return parsePlanningPayload(payload);
  }

  if (input.action === "setPersonHidden") {
    const visibleIds = new Set([...payload.staff.map((person) => person.id), ...activeAccounts]);
    if (!visibleIds.has(input.id)) throw new Error("PLANNING_USER_NOT_ACTIVE");
    payload.hiddenPersonIds = input.hidden
      ? [...new Set([...payload.hiddenPersonIds, input.id])]
      : payload.hiddenPersonIds.filter((id) => id !== input.id);
    return parsePlanningPayload(payload);
  }

  const person = payload.staff.find((candidate) => candidate.id === input.id);
  if (!person) throw new Error("PLANNING_STAFF_NOT_FOUND");

  if (input.action === "setStaffEndDate") {
    if (
      input.endDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ||
        Number.isNaN(new Date(input.endDate + "T12:00:00Z").getTime()) ||
        new Date(input.endDate + "T12:00:00Z").toISOString().slice(0, 10) !== input.endDate)
    )
      throw new Error("PLANNING_END_DATE_INVALID");
    person.endDate = input.endDate;
    return parsePlanningPayload(payload);
  }
  if (input.action === "deactivateStaff") {
    const today = new Date().toISOString().slice(0, 10);
    person.inactiveSince = today;
    return parsePlanningPayload(payload);
  }
  if (input.action === "reactivateStaff") {
    person.inactiveSince = null;
    return parsePlanningPayload(payload);
  }
  if (input.action === "deleteStaff") {
    if (
      person.linkedUserId ||
      payload.absences.some((absence) => absence.userId === person.id) ||
      payload.dailyAssignments.some((entry) => entry.userId === person.id) ||
      payload.actualHours.some((entry) => entry.userId === person.id) ||
      payload.indirectHours.some((entry) => entry.userId === person.id)
    )
      throw new Error("PLANNING_STAFF_HAS_HISTORY");
    payload.staff = payload.staff.filter((candidate) => candidate.id !== person.id);
    payload.peopleCapacity = payload.peopleCapacity.filter((entry) => entry.userId !== person.id);
    payload.hiddenPersonIds = payload.hiddenPersonIds.filter((id) => id !== person.id);
    return parsePlanningPayload(payload);
  }

  const accountId = input.linkedUserId;
  if (accountId !== null) {
    if (!activeAccounts.has(accountId)) throw new Error("PLANNING_ACCOUNT_NOT_ACTIVE");
    if (
      payload.staff.some(
        (candidate) => candidate.id !== person.id && candidate.linkedUserId === accountId,
      )
    )
      throw new Error("PLANNING_ACCOUNT_ALREADY_LINKED");

    // Existing account schedules and absences must never disappear after linking.
    const legacyCapacity = payload.peopleCapacity.find((entry) => entry.userId === accountId);
    const staffCapacity = payload.peopleCapacity.find((entry) => entry.userId === person.id);
    const untouchedNewStaffSchedule =
      staffCapacity &&
      !staffCapacity.countsInMacroCapacity &&
      Object.entries(NEW_STAFF_WEEKLY_SCHEDULE).every(
        ([day, hours]) =>
          staffCapacity.weeklySchedule[day as keyof typeof NEW_STAFF_WEEKLY_SCHEDULE] === hours,
      );
    if (legacyCapacity && staffCapacity && !untouchedNewStaffSchedule) {
      throw new Error("PLANNING_STAFF_CAPACITY_CONFLICT");
    }
    const staffAbsenceDays = new Set(
      payload.absences
        .filter((absence) => absence.userId === person.id)
        .map((absence) => absence.date),
    );
    if (
      payload.absences.some(
        (absence) => absence.userId === accountId && staffAbsenceDays.has(absence.date),
      )
    )
      throw new Error("PLANNING_STAFF_ABSENCE_CONFLICT");

    const staffAssignedDates = new Set(
      payload.dailyAssignments
        .filter((assignment) => assignment.userId === person.id)
        .map((assignment) => assignment.date),
    );
    if (
      payload.dailyAssignments.some(
        (assignment) => assignment.userId === accountId && staffAssignedDates.has(assignment.date),
      )
    ) {
      throw new Error("PLANNING_STAFF_DAILY_ASSIGNMENT_CONFLICT");
    }

    if (legacyCapacity && staffCapacity) {
      // The newly created untouched default must not block association with
      // an older account: move the existing account schedule to the staff ID.
      staffCapacity.countsInMacroCapacity = legacyCapacity.countsInMacroCapacity;
      staffCapacity.weeklySchedule = { ...legacyCapacity.weeklySchedule };
      payload.peopleCapacity = payload.peopleCapacity.filter((entry) => entry !== legacyCapacity);
    } else if (legacyCapacity) {
      legacyCapacity.userId = person.id;
    }
    for (const absence of payload.absences) {
      if (absence.userId === accountId) absence.userId = person.id;
    }
    for (const assignment of payload.dailyAssignments) {
      if (assignment.userId === accountId) assignment.userId = person.id;
    }
  }
  if (accountId && payload.hiddenPersonIds.includes(accountId)) {
    payload.hiddenPersonIds = [
      ...new Set([...payload.hiddenPersonIds.filter((id) => id !== accountId), person.id]),
    ];
  }
  person.linkedUserId = accountId;
  return parsePlanningPayload(payload);
}

export function staffIdentityExists(staff: readonly PlanningStaff[], personId: string): boolean {
  return staff.some((person) => person.id === personId);
}
