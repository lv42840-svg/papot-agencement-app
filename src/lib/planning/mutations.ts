import { z } from "zod";
import { DEFAULT_WEEKLY_SCHEDULE, isoWeekDates, scheduleHoursForDate } from "./capacity";
import { assertCombinedPersonWeekLimit } from "./actual-hours";
import { isoWeekKey } from "./time-markers";
import {
  actualHoursKey,
  allocationKey,
  parsePlanningPayload,
  provisionalAllocationKey,
  planningAbsenceTypeSchema,
  planningActivitySchema,
  type PlanningPayload,
} from "./domain";

const weekSchema = z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "PLANNING_WEEK_INVALID");

const weekdayHoursMutationSchema = z.object({
  monday: z.number().finite().nonnegative().max(24),
  tuesday: z.number().finite().nonnegative().max(24),
  wednesday: z.number().finite().nonnegative().max(24),
  thursday: z.number().finite().nonnegative().max(24),
  friday: z.number().finite().nonnegative().max(24),
  saturday: z.number().finite().nonnegative().max(24),
  sunday: z.number().finite().nonnegative().max(24),
});

export const planningMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setMacroHours"),
    chantierId: z.string().uuid(),
    activity: planningActivitySchema,
    week: weekSchema,
    hours: z.number().finite().nonnegative().max(10_000),
  }),
  z.object({
    action: z.literal("setHoursBatch"),
    updates: z
      .array(
        z.object({
          kind: z.enum(["firm", "provisional"]),
          id: z.string().uuid(),
          activity: planningActivitySchema,
          week: weekSchema,
          hours: z.number().finite().nonnegative().max(10_000),
        }),
      )
      .min(1)
      .max(200),
  }),
  z.object({
    action: z.literal("setActualHours"),
    chantierId: z.string().uuid(),
    userId: z.string().uuid(),
    activity: planningActivitySchema,
    week: weekSchema,
    hours: z.number().finite().nonnegative().max(168),
  }),
  z.object({
    action: z.literal("setChantierOrder"),
    orderedChantierIds: z.array(z.string().uuid()).max(1000),
  }),
  z.object({
    action: z.literal("setProvisionHours"),
    caseId: z.string().uuid(),
    activity: planningActivitySchema,
    week: weekSchema,
    hours: z.number().finite().nonnegative().max(10_000),
  }),
  z.object({
    action: z.literal("setPotentialOrder"),
    orderedCaseIds: z.array(z.string().uuid()).max(1000),
  }),
  z.object({
    action: z.literal("saveStaff"),
    id: z.string().uuid().optional(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("linkStaffAccount"),
    id: z.string().uuid(),
    linkedUserId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("setPersonHidden"),
    id: z.string().uuid(),
    hidden: z.boolean(),
  }),
  z.object({
    action: z.literal("setStaffEndDate"),
    id: z.string().uuid(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  }),
  z.object({ action: z.literal("deactivateStaff"), id: z.string().uuid() }),
  z.object({ action: z.literal("reactivateStaff"), id: z.string().uuid() }),
  z.object({ action: z.literal("deleteStaff"), id: z.string().uuid() }),
  z.object({
    action: z.literal("setPersonCapacity"),
    userId: z.string().uuid(),
    countsInMacroCapacity: z.boolean(),
    weeklySchedule: weekdayHoursMutationSchema,
  }),
  z.object({
    action: z.literal("setAbsence"),
    id: z.string().uuid().optional(),
    userId: z.string().uuid(),
    type: planningAbsenceTypeSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "PLANNING_ABSENCE_DATE_INVALID"),
    hours: z.number().finite().positive().max(24),
  }),
  z.object({
    action: z.literal("setFullWeekAbsence"),
    userId: z.string().uuid(),
    type: planningAbsenceTypeSchema,
    week: weekSchema,
  }),
  z.object({
    action: z.literal("deleteAbsence"),
    absenceId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("deleteAbsenceBatch"),
    absenceIds: z.array(z.string().uuid()).min(1).max(7),
  }),
]);

export const planningMacroMutationSchema = planningMutationSchema.options[0];
export type PlanningMutation = z.infer<typeof planningMutationSchema>;
export type PlanningMacroMutation = Extract<PlanningMutation, { action: "setMacroHours" }>;
export type PlanningHoursBatchMutation = Extract<PlanningMutation, { action: "setHoursBatch" }>;
export type PlanningActualHoursMutation = Extract<PlanningMutation, { action: "setActualHours" }>;
export type PlanningChantierOrderMutation = Extract<
  PlanningMutation,
  { action: "setChantierOrder" }
>;
export type PlanningProvisionalMutation = Extract<
  PlanningMutation,
  { action: "setProvisionHours" }
>;
export type PlanningPotentialOrderMutation = Extract<
  PlanningMutation,
  { action: "setPotentialOrder" }
>;
export type PlanningPersonCapacityMutation = Extract<
  PlanningMutation,
  { action: "setPersonCapacity" }
>;
export type PlanningAbsenceMutation = Extract<PlanningMutation, { action: "setAbsence" }>;
export type PlanningFullWeekAbsenceMutation = Extract<
  PlanningMutation,
  { action: "setFullWeekAbsence" }
>;
export type PlanningDeleteAbsenceMutation = Extract<PlanningMutation, { action: "deleteAbsence" }>;
export type PlanningDeleteAbsenceBatchMutation = Extract<
  PlanningMutation,
  { action: "deleteAbsenceBatch" }
>;

export function applyPlanningMacroMutation(
  source: PlanningPayload,
  saisie: PlanningMacroMutation,
  activeChantierIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeChantierIds.has(saisie.chantierId)) {
    throw new Error("PLANNING_CHANTIER_NOT_ACTIVE");
  }

  const contenu = structuredClone(parsePlanningPayload(source));
  const cle = allocationKey(saisie.chantierId, saisie.activity, saisie.week);
  const indice = contenu.macroAllocations.findIndex(
    (allocation) =>
      allocationKey(allocation.chantierId, allocation.activity, allocation.week) === cle,
  );

  if (saisie.hours === 0) {
    if (indice >= 0) contenu.macroAllocations.splice(indice, 1);
    return parsePlanningPayload(contenu);
  }

  const suivant = {
    chantierId: saisie.chantierId,
    activity: saisie.activity,
    week: saisie.week,
    hours: saisie.hours,
  };

  if (indice >= 0) contenu.macroAllocations[indice] = suivant;
  else contenu.macroAllocations.push(suivant);

  return parsePlanningPayload(contenu);
}

export function applyPlanningHoursBatchMutation(
  source: PlanningPayload,
  saisie: PlanningHoursBatchMutation,
  activeChantierIds: ReadonlySet<string>,
  activeCommercialCaseIds: ReadonlySet<string>,
): PlanningPayload {
  // Check every cell before changing anything. The repository commits this payload atomically.
  const seen = new Set<string>();
  for (const update of saisie.updates) {
    const cle = [update.kind, update.id, update.activity, update.week].join(":");
    if (seen.has(cle)) throw new Error("PLANNING_BATCH_DUPLICATE_INVALID");
    seen.add(cle);
    if (update.kind === "firm" && !activeChantierIds.has(update.id)) {
      throw new Error("PLANNING_CHANTIER_NOT_ACTIVE");
    }
    if (update.kind === "provisional" && !activeCommercialCaseIds.has(update.id)) {
      throw new Error("PLANNING_COMMERCIAL_CASE_NOT_ACTIVE");
    }
  }

  const contenu = structuredClone(parsePlanningPayload(source));
  const firm = new Map<string, PlanningPayload["macroAllocations"][number]>(
    contenu.macroAllocations.map((element) => [
      allocationKey(element.chantierId, element.activity, element.week),
      element,
    ]),
  );
  const provisional = new Map<string, PlanningPayload["provisionalAllocations"][number]>(
    contenu.provisionalAllocations.map((element) => [
      provisionalAllocationKey(element.caseId, element.activity, element.week),
      element,
    ]),
  );

  for (const update of saisie.updates) {
    if (update.kind === "firm") {
      const cle = allocationKey(update.id, update.activity, update.week);
      if (update.hours === 0) firm.delete(cle);
      else
        firm.set(cle, {
          chantierId: update.id,
          activity: update.activity,
          week: update.week,
          hours: update.hours,
        });
    } else {
      const cle = provisionalAllocationKey(update.id, update.activity, update.week);
      if (update.hours === 0) provisional.delete(cle);
      else {
        provisional.set(cle, {
          caseId: update.id,
          activity: update.activity,
          week: update.week,
          hours: update.hours,
        });
        if (!contenu.provisionalOrder.includes(update.id)) {
          contenu.provisionalOrder.unshift(update.id);
        }
      }
    }
  }

  contenu.macroAllocations = [...firm.values()];
  contenu.provisionalAllocations = [...provisional.values()];
  return parsePlanningPayload(contenu);
}

export function applyPlanningActualHoursMutation(
  source: PlanningPayload,
  saisie: PlanningActualHoursMutation,
  activeChantierIds: ReadonlySet<string>,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeChantierIds.has(saisie.chantierId)) {
    throw new Error("PLANNING_CHANTIER_NOT_ACTIVE");
  }
  if (!activeUserIds.has(saisie.userId)) {
    throw new Error("PLANNING_USER_NOT_ACTIVE");
  }

  const contenu = structuredClone(parsePlanningPayload(source));
  const cle = actualHoursKey(saisie.chantierId, saisie.userId, saisie.activity, saisie.week);
  const indice = contenu.actualHours.findIndex(
    (entree) =>
      actualHoursKey(entree.chantierId, entree.userId, entree.activity, entree.week) === cle,
  );

  if (saisie.hours === 0) {
    if (indice >= 0) contenu.actualHours.splice(indice, 1);
    return parsePlanningPayload(contenu);
  }

  const suivant = {
    chantierId: saisie.chantierId,
    userId: saisie.userId,
    activity: saisie.activity,
    week: saisie.week,
    hours: saisie.hours,
  };

  if (indice >= 0) contenu.actualHours[indice] = suivant;
  else contenu.actualHours.push(suivant);
  assertCombinedPersonWeekLimit(contenu, saisie.userId, saisie.week);

  return parsePlanningPayload(contenu);
}

export function applyPlanningChantierOrderMutation(
  source: PlanningPayload,
  saisie: PlanningChantierOrderMutation,
  activeChantierIds: ReadonlySet<string>,
): PlanningPayload {
  if (new Set(saisie.orderedChantierIds).size !== saisie.orderedChantierIds.length) {
    throw new Error("PLANNING_CHANTIER_ORDER_DUPLICATE");
  }
  if (
    saisie.orderedChantierIds.length !== activeChantierIds.size ||
    saisie.orderedChantierIds.some((chantierId) => !activeChantierIds.has(chantierId))
  ) {
    throw new Error("PLANNING_CHANTIER_ORDER_INVALID");
  }

  const contenu = structuredClone(parsePlanningPayload(source));
  contenu.chantierOrder = [...saisie.orderedChantierIds];
  return parsePlanningPayload(contenu);
}

export function applyPlanningProvisionalMutation(
  source: PlanningPayload,
  saisie: PlanningProvisionalMutation,
  activeCommercialCaseIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeCommercialCaseIds.has(saisie.caseId)) {
    throw new Error("PLANNING_COMMERCIAL_CASE_NOT_ACTIVE");
  }

  const contenu = structuredClone(parsePlanningPayload(source));
  const cle = provisionalAllocationKey(saisie.caseId, saisie.activity, saisie.week);
  const indice = contenu.provisionalAllocations.findIndex(
    (allocation) =>
      provisionalAllocationKey(allocation.caseId, allocation.activity, allocation.week) === cle,
  );

  if (saisie.hours === 0) {
    if (indice >= 0) contenu.provisionalAllocations.splice(indice, 1);
    return parsePlanningPayload(contenu);
  }

  const suivant = {
    caseId: saisie.caseId,
    activity: saisie.activity,
    week: saisie.week,
    hours: saisie.hours,
  };

  if (indice >= 0) contenu.provisionalAllocations[indice] = suivant;
  else contenu.provisionalAllocations.push(suivant);

  if (!contenu.provisionalOrder.includes(saisie.caseId)) {
    contenu.provisionalOrder = [
      saisie.caseId,
      ...contenu.provisionalOrder.filter((candidat) => candidat !== saisie.caseId),
    ];
  }

  return parsePlanningPayload(contenu);
}

export function applyPlanningPotentialOrderMutation(
  source: PlanningPayload,
  saisie: PlanningPotentialOrderMutation,
  activePotentialCaseIds: ReadonlySet<string>,
): PlanningPayload {
  if (new Set(saisie.orderedCaseIds).size !== saisie.orderedCaseIds.length) {
    throw new Error("PLANNING_POTENTIAL_ORDER_DUPLICATE");
  }
  if (
    saisie.orderedCaseIds.length !== activePotentialCaseIds.size ||
    saisie.orderedCaseIds.some((idAffaire) => !activePotentialCaseIds.has(idAffaire))
  ) {
    throw new Error("PLANNING_POTENTIAL_ORDER_INVALID");
  }

  const contenu = structuredClone(parsePlanningPayload(source));
  contenu.provisionalOrder = [...saisie.orderedCaseIds];
  return parsePlanningPayload(contenu);
}

export function convertPlanningProvisionToFirm(
  source: PlanningPayload,
  commercialCaseId: string,
  chantierId: string,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  const matching = contenu.provisionalAllocations.filter(
    (allocation) => allocation.caseId === commercialCaseId,
  );

  for (const allocation of matching) {
    const cle = allocationKey(chantierId, allocation.activity, allocation.week);
    const existingIndex = contenu.macroAllocations.findIndex(
      (candidat) => allocationKey(candidat.chantierId, candidat.activity, candidat.week) === cle,
    );
    const firmAllocation = {
      chantierId,
      activity: allocation.activity,
      week: allocation.week,
      hours: allocation.hours,
    };

    if (existingIndex >= 0) contenu.macroAllocations[existingIndex] = firmAllocation;
    else contenu.macroAllocations.push(firmAllocation);
  }

  contenu.provisionalAllocations = contenu.provisionalAllocations.filter(
    (allocation) => allocation.caseId !== commercialCaseId,
  );
  contenu.provisionalOrder = contenu.provisionalOrder.filter(
    (candidat) => candidat !== commercialCaseId,
  );
  contenu.chantierOrder = [
    chantierId,
    ...contenu.chantierOrder.filter((candidat) => candidat !== chantierId),
  ];

  return parsePlanningPayload(contenu);
}

export function clearPlanningProvisionForCommercialCase(
  source: PlanningPayload,
  commercialCaseId: string,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  contenu.provisionalAllocations = contenu.provisionalAllocations.filter(
    (allocation) => allocation.caseId !== commercialCaseId,
  );
  contenu.provisionalOrder = contenu.provisionalOrder.filter(
    (candidat) => candidat !== commercialCaseId,
  );
  return parsePlanningPayload(contenu);
}

export function syncPlanningPotentialOrderForCommercialCase(
  source: PlanningPayload,
  commercialCaseId: string,
  hasProvisionReference: boolean,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  const isKnown = contenu.provisionalOrder.includes(commercialCaseId);
  const hasWeeklyAllocation = contenu.provisionalAllocations.some(
    (allocation) => allocation.caseId === commercialCaseId,
  );

  if (hasProvisionReference) {
    if (!isKnown) {
      contenu.provisionalOrder = [
        commercialCaseId,
        ...contenu.provisionalOrder.filter((candidat) => candidat !== commercialCaseId),
      ];
    }
  } else if (!hasWeeklyAllocation) {
    contenu.provisionalOrder = contenu.provisionalOrder.filter(
      (candidat) => candidat !== commercialCaseId,
    );
  }

  return parsePlanningPayload(contenu);
}

export function removeFirmPlanningForChantier(
  source: PlanningPayload,
  chantierId: string,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  contenu.macroAllocations = contenu.macroAllocations.filter(
    (allocation) => allocation.chantierId !== chantierId,
  );
  contenu.chantierOrder = contenu.chantierOrder.filter((candidat) => candidat !== chantierId);
  return parsePlanningPayload(contenu);
}

export function restoreFirmPlanningOrderForChantier(
  source: PlanningPayload,
  chantierId: string,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  contenu.macroAllocations = contenu.macroAllocations.filter(
    (allocation) => allocation.chantierId !== chantierId,
  );
  contenu.chantierOrder = [
    chantierId,
    ...contenu.chantierOrder.filter((candidat) => candidat !== chantierId),
  ];
  return parsePlanningPayload(contenu);
}

export function applyPlanningPersonCapacityMutation(
  source: PlanningPayload,
  saisie: PlanningPersonCapacityMutation,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeUserIds.has(saisie.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");

  const contenu = structuredClone(parsePlanningPayload(source));
  const indice = contenu.peopleCapacity.findIndex((personne) => personne.userId === saisie.userId);
  const suivant = {
    userId: saisie.userId,
    countsInMacroCapacity: saisie.countsInMacroCapacity,
    weeklySchedule: saisie.weeklySchedule ?? DEFAULT_WEEKLY_SCHEDULE,
  };

  if (indice >= 0) contenu.peopleCapacity[indice] = suivant;
  else contenu.peopleCapacity.push(suivant);

  return parsePlanningPayload(contenu);
}

function effectiveSchedule(contenu: PlanningPayload, idUtilisateur: string) {
  return (
    contenu.peopleCapacity.find((personne) => personne.userId === idUtilisateur)?.weeklySchedule ??
    DEFAULT_WEEKLY_SCHEDULE
  );
}

export function applyPlanningAbsenceMutation(
  source: PlanningPayload,
  saisie: PlanningAbsenceMutation,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeUserIds.has(saisie.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");

  const contenu = structuredClone(parsePlanningPayload(source));
  const sameDateIndex = contenu.absences.findIndex(
    (absence) => absence.userId === saisie.userId && absence.date === saisie.date,
  );
  const byIdIndex = saisie.id
    ? contenu.absences.findIndex((absence) => absence.id === saisie.id)
    : -1;
  const indice = byIdIndex >= 0 ? byIdIndex : sameDateIndex;
  // Editing a day in a generated week breaks that original group into
  // individual dates. No remaining day is mislabeled as a whole week.
  const oldGroup = indice >= 0 ? contenu.absences[indice].weekGroupId : undefined;
  if (oldGroup) {
    contenu.absences = contenu.absences.map((absence) =>
      absence.weekGroupId === oldGroup ? { ...absence, weekGroupId: undefined } : absence,
    );
  }
  const suivant = {
    id: indice >= 0 ? contenu.absences[indice].id : crypto.randomUUID(),
    userId: saisie.userId,
    type: saisie.type,
    date: saisie.date,
    hours: saisie.hours,
  };

  if (indice >= 0) contenu.absences[indice] = suivant;
  else contenu.absences.push(suivant);

  return parsePlanningPayload(contenu);
}

export function applyPlanningFullWeekAbsenceMutation(
  source: PlanningPayload,
  saisie: PlanningFullWeekAbsenceMutation,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeUserIds.has(saisie.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");

  const contenu = structuredClone(parsePlanningPayload(source));
  const schedule = effectiveSchedule(contenu, saisie.userId);
  const weekDates = isoWeekDates(saisie.week);
  const weekDateIds = new Set(weekDates.map((date) => date.toISOString().slice(0, 10)));

  contenu.absences = contenu.absences.filter(
    (absence) => absence.userId !== saisie.userId || !weekDateIds.has(absence.date),
  );

  const weekGroupId = crypto.randomUUID();
  for (const date of weekDates) {
    const heures = scheduleHoursForDate(schedule, date);
    if (heures <= 0) continue;
    contenu.absences.push({
      id: crypto.randomUUID(),
      userId: saisie.userId,
      type: saisie.type,
      date: date.toISOString().slice(0, 10),
      hours: heures,
      weekGroupId,
    });
  }

  return parsePlanningPayload(contenu);
}

export function applyPlanningDeleteAbsenceMutation(
  source: PlanningPayload,
  saisie: PlanningDeleteAbsenceMutation,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  const selectionne = contenu.absences.find((absence) => absence.id === saisie.absenceId);
  const groupId = selectionne?.weekGroupId;
  contenu.absences = contenu.absences
    .filter((absence) => absence.id !== saisie.absenceId)
    .map((absence) =>
      groupId && absence.weekGroupId === groupId ? { ...absence, weekGroupId: undefined } : absence,
    );
  return parsePlanningPayload(contenu);
}

export function applyPlanningDeleteAbsenceBatchMutation(
  source: PlanningPayload,
  saisie: PlanningDeleteAbsenceBatchMutation,
): PlanningPayload {
  const contenu = structuredClone(parsePlanningPayload(source));
  const identifiants = new Set(saisie.absenceIds);
  if (identifiants.size !== saisie.absenceIds.length)
    throw new Error("PLANNING_ABSENCE_BATCH_DUPLICATE");
  const selectionne = contenu.absences.filter((absence) => identifiants.has(absence.id));
  if (selectionne.length !== identifiants.size) throw new Error("PLANNING_ABSENCE_NOT_FOUND");
  const first = selectionne[0];
  const weekDates = new Set(
    isoWeekDates(isoWeekKey(new Date(first.date + "T12:00:00Z"))).map((date) =>
      date.toISOString().slice(0, 10),
    ),
  );
  if (
    selectionne.some((absence) => absence.userId !== first.userId || !weekDates.has(absence.date))
  )
    throw new Error("PLANNING_ABSENCE_BATCH_INVALID");
  contenu.absences = contenu.absences.filter((absence) => !identifiants.has(absence.id));
  const orphanGroupIds = new Set(
    selectionne.map((absence) => absence.weekGroupId).filter((id): id is string => !!id),
  );
  contenu.absences = contenu.absences.map((absence) =>
    absence.weekGroupId && orphanGroupIds.has(absence.weekGroupId)
      ? { ...absence, weekGroupId: undefined }
      : absence,
  );
  return parsePlanningPayload(contenu);
}
