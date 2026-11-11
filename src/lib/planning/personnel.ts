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
  contenu: Pick<PlanningPayload, "staff" | "peopleCapacity" | "hiddenPersonIds">,
  accounts: readonly PlanningAccount[],
): PlanningVisiblePerson[] {
  const saved = new Map(contenu.peopleCapacity.map((personne) => [personne.userId, personne]));
  const linked = new Set(contenu.staff.map((personne) => personne.linkedUserId).filter(Boolean));
  const hidden = new Set(contenu.hiddenPersonIds);
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
  const staff: PlanningVisiblePerson[] = contenu.staff.map((personne) => ({
    ...(saved.get(personne.id) ?? {
      userId: personne.id,
      countsInMacroCapacity: false,
      weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
    }),
    displayName: `${personne.firstName} ${personne.lastName}`,
    kind: "staff",
    firstName: personne.firstName,
    lastName: personne.lastName,
    linkedUserId: personne.linkedUserId,
    hiddenInWeeklyBoard: hidden.has(personne.id),
    endDate: personne.endDate,
    inactiveSince: personne.inactiveSince,
  }));
  return [...legacy, ...staff];
}

export function personPresentOnDate(
  personne: Pick<PlanningVisiblePerson, "endDate" | "inactiveSince">,
  date: string,
): boolean {
  return (
    (!personne.endDate || date <= personne.endDate) &&
    (!personne.inactiveSince || date < personne.inactiveSince)
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
  saisie: PlanningStaffMutation,
  activeAccounts: ReadonlySet<string>,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  if (saisie.action === "saveStaff") {
    const firstName = saisie.firstName.trim();
    const lastName = saisie.lastName.trim();
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      throw new Error("PLANNING_STAFF_NAME_INVALID");
    }
    if (saisie.id) {
      const personne = contenu.staff.find((candidat) => candidat.id === saisie.id);
      if (!personne) throw new Error("PLANNING_STAFF_NOT_FOUND");
      personne.firstName = firstName;
      personne.lastName = lastName;
    } else {
      const personId = crypto.randomUUID();
      contenu.staff.push({
        id: personId,
        firstName,
        lastName,
        linkedUserId: null,
        endDate: null,
        inactiveSince: null,
      });
      contenu.peopleCapacity.push({
        userId: personId,
        countsInMacroCapacity: false,
        weeklySchedule: { ...NEW_STAFF_WEEKLY_SCHEDULE },
      });
    }
    return parsePlanningPayload(contenu);
  }

  if (saisie.action === "setPersonHidden") {
    const visibleIds = new Set([
      ...contenu.staff.map((personne) => personne.id),
      ...activeAccounts,
    ]);
    if (!visibleIds.has(saisie.id)) throw new Error("PLANNING_USER_NOT_ACTIVE");
    contenu.hiddenPersonIds = saisie.hidden
      ? [...new Set([...contenu.hiddenPersonIds, saisie.id])]
      : contenu.hiddenPersonIds.filter((id) => id !== saisie.id);
    return parsePlanningPayload(contenu);
  }

  const personne = contenu.staff.find((candidat) => candidat.id === saisie.id);
  if (!personne) throw new Error("PLANNING_STAFF_NOT_FOUND");

  if (saisie.action === "setStaffEndDate") {
    if (
      saisie.endDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(saisie.endDate) ||
        Number.isNaN(new Date(saisie.endDate + "T12:00:00Z").getTime()) ||
        new Date(saisie.endDate + "T12:00:00Z").toISOString().slice(0, 10) !== saisie.endDate)
    )
      throw new Error("PLANNING_END_DATE_INVALID");
    personne.endDate = saisie.endDate;
    return parsePlanningPayload(contenu);
  }
  if (saisie.action === "deactivateStaff") {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    personne.inactiveSince = aujourdhui;
    return parsePlanningPayload(contenu);
  }
  if (saisie.action === "reactivateStaff") {
    personne.inactiveSince = null;
    return parsePlanningPayload(contenu);
  }
  if (saisie.action === "deleteStaff") {
    if (
      personne.linkedUserId ||
      contenu.absences.some((absence) => absence.userId === personne.id) ||
      contenu.dailyAssignments.some((entree) => entree.userId === personne.id) ||
      contenu.actualHours.some((entree) => entree.userId === personne.id) ||
      contenu.indirectHours.some((entree) => entree.userId === personne.id)
    )
      throw new Error("PLANNING_STAFF_HAS_HISTORY");
    contenu.staff = contenu.staff.filter((candidat) => candidat.id !== personne.id);
    contenu.peopleCapacity = contenu.peopleCapacity.filter(
      (entree) => entree.userId !== personne.id,
    );
    contenu.hiddenPersonIds = contenu.hiddenPersonIds.filter((id) => id !== personne.id);
    return parsePlanningPayload(contenu);
  }

  const accountId = saisie.linkedUserId;
  if (accountId !== null) {
    if (!activeAccounts.has(accountId)) throw new Error("PLANNING_ACCOUNT_NOT_ACTIVE");
    if (
      contenu.staff.some(
        (candidat) => candidat.id !== personne.id && candidat.linkedUserId === accountId,
      )
    )
      throw new Error("PLANNING_ACCOUNT_ALREADY_LINKED");

    // Existing account schedules and absences must never disappear after linking.
    const legacyCapacity = contenu.peopleCapacity.find((entree) => entree.userId === accountId);
    const staffCapacity = contenu.peopleCapacity.find((entree) => entree.userId === personne.id);
    const untouchedNewStaffSchedule =
      staffCapacity &&
      !staffCapacity.countsInMacroCapacity &&
      Object.entries(NEW_STAFF_WEEKLY_SCHEDULE).every(
        ([jour, heures]) =>
          staffCapacity.weeklySchedule[jour as keyof typeof NEW_STAFF_WEEKLY_SCHEDULE] === heures,
      );
    if (legacyCapacity && staffCapacity && !untouchedNewStaffSchedule) {
      throw new Error("PLANNING_STAFF_CAPACITY_CONFLICT");
    }
    const staffAbsenceDays = new Set(
      contenu.absences
        .filter((absence) => absence.userId === personne.id)
        .map((absence) => absence.date),
    );
    if (
      contenu.absences.some(
        (absence) => absence.userId === accountId && staffAbsenceDays.has(absence.date),
      )
    )
      throw new Error("PLANNING_STAFF_ABSENCE_CONFLICT");

    const staffAssignedDates = new Set(
      contenu.dailyAssignments
        .filter((assignment) => assignment.userId === personne.id)
        .map((assignment) => assignment.date),
    );
    if (
      contenu.dailyAssignments.some(
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
      contenu.peopleCapacity = contenu.peopleCapacity.filter((entree) => entree !== legacyCapacity);
    } else if (legacyCapacity) {
      legacyCapacity.userId = personne.id;
    }
    for (const absence of contenu.absences) {
      if (absence.userId === accountId) absence.userId = personne.id;
    }
    for (const assignment of contenu.dailyAssignments) {
      if (assignment.userId === accountId) assignment.userId = personne.id;
    }
  }
  if (accountId && contenu.hiddenPersonIds.includes(accountId)) {
    contenu.hiddenPersonIds = [
      ...new Set([...contenu.hiddenPersonIds.filter((id) => id !== accountId), personne.id]),
    ];
  }
  personne.linkedUserId = accountId;
  return parsePlanningPayload(contenu);
}

export function staffIdentityExists(staff: readonly PlanningStaff[], personId: string): boolean {
  return staff.some((personne) => personne.id === personId);
}
