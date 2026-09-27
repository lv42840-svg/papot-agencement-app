import { z } from "zod";
import { DEFAULT_WEEKLY_SCHEDULE, isoWeekDates, scheduleHoursForDate } from "./capacity";
import {
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
    action: z.literal("setProvisionHours"),
    caseId: z.string().uuid(),
    activity: planningActivitySchema,
    week: weekSchema,
    hours: z.number().finite().nonnegative().max(10_000),
  }),
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
]);

export const planningMacroMutationSchema = planningMutationSchema.options[0];
export type PlanningMutation = z.infer<typeof planningMutationSchema>;
export type PlanningMacroMutation = Extract<PlanningMutation, { action: "setMacroHours" }>;
export type PlanningProvisionalMutation = Extract<
  PlanningMutation,
  { action: "setProvisionHours" }
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

export function applyPlanningMacroMutation(
  source: PlanningPayload,
  input: PlanningMacroMutation,
  activeChantierIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeChantierIds.has(input.chantierId)) {
    throw new Error("PLANNING_CHANTIER_NOT_ACTIVE");
  }

  const payload = structuredClone(parsePlanningPayload(source));
  const key = allocationKey(input.chantierId, input.activity, input.week);
  const index = payload.macroAllocations.findIndex(
    (allocation) =>
      allocationKey(allocation.chantierId, allocation.activity, allocation.week) === key,
  );

  if (input.hours === 0) {
    if (index >= 0) payload.macroAllocations.splice(index, 1);
    return parsePlanningPayload(payload);
  }

  const next = {
    chantierId: input.chantierId,
    activity: input.activity,
    week: input.week,
    hours: input.hours,
  };

  if (index >= 0) payload.macroAllocations[index] = next;
  else payload.macroAllocations.push(next);

  return parsePlanningPayload(payload);
}

export function applyPlanningProvisionalMutation(
  source: PlanningPayload,
  input: PlanningProvisionalMutation,
  activeCommercialCaseIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeCommercialCaseIds.has(input.caseId)) {
    throw new Error("PLANNING_COMMERCIAL_CASE_NOT_ACTIVE");
  }

  const payload = structuredClone(parsePlanningPayload(source));
  const key = provisionalAllocationKey(input.caseId, input.activity, input.week);
  const index = payload.provisionalAllocations.findIndex(
    (allocation) =>
      provisionalAllocationKey(allocation.caseId, allocation.activity, allocation.week) === key,
  );

  if (input.hours === 0) {
    if (index >= 0) payload.provisionalAllocations.splice(index, 1);
    return parsePlanningPayload(payload);
  }

  const next = {
    caseId: input.caseId,
    activity: input.activity,
    week: input.week,
    hours: input.hours,
  };

  if (index >= 0) payload.provisionalAllocations[index] = next;
  else payload.provisionalAllocations.push(next);

  if (!payload.provisionalOrder.includes(input.caseId)) {
    payload.provisionalOrder = [
      input.caseId,
      ...payload.provisionalOrder.filter((candidate) => candidate !== input.caseId),
    ];
  }

  return parsePlanningPayload(payload);
}

export function convertPlanningProvisionToFirm(
  source: PlanningPayload,
  commercialCaseId: string,
  chantierId: string,
): PlanningPayload {
  const payload = structuredClone(parsePlanningPayload(source));
  const matching = payload.provisionalAllocations.filter(
    (allocation) => allocation.caseId === commercialCaseId,
  );

  for (const allocation of matching) {
    const key = allocationKey(chantierId, allocation.activity, allocation.week);
    const existingIndex = payload.macroAllocations.findIndex(
      (candidate) =>
        allocationKey(candidate.chantierId, candidate.activity, candidate.week) === key,
    );
    const firmAllocation = {
      chantierId,
      activity: allocation.activity,
      week: allocation.week,
      hours: allocation.hours,
    };

    if (existingIndex >= 0) payload.macroAllocations[existingIndex] = firmAllocation;
    else payload.macroAllocations.push(firmAllocation);
  }

  payload.provisionalAllocations = payload.provisionalAllocations.filter(
    (allocation) => allocation.caseId !== commercialCaseId,
  );
  payload.provisionalOrder = payload.provisionalOrder.filter(
    (candidate) => candidate !== commercialCaseId,
  );
  payload.chantierOrder = [
    chantierId,
    ...payload.chantierOrder.filter((candidate) => candidate !== chantierId),
  ];

  return parsePlanningPayload(payload);
}

export function clearPlanningProvisionForCommercialCase(
  source: PlanningPayload,
  commercialCaseId: string,
): PlanningPayload {
  const payload = structuredClone(parsePlanningPayload(source));
  payload.provisionalAllocations = payload.provisionalAllocations.filter(
    (allocation) => allocation.caseId !== commercialCaseId,
  );
  payload.provisionalOrder = payload.provisionalOrder.filter(
    (candidate) => candidate !== commercialCaseId,
  );
  return parsePlanningPayload(payload);
}

export function syncPlanningPotentialOrderForCommercialCase(
  source: PlanningPayload,
  commercialCaseId: string,
  hasProvisionReference: boolean,
): PlanningPayload {
  const payload = structuredClone(parsePlanningPayload(source));
  const isKnown = payload.provisionalOrder.includes(commercialCaseId);
  const hasWeeklyAllocation = payload.provisionalAllocations.some(
    (allocation) => allocation.caseId === commercialCaseId,
  );

  if (hasProvisionReference) {
    if (!isKnown) {
      payload.provisionalOrder = [
        commercialCaseId,
        ...payload.provisionalOrder.filter((candidate) => candidate !== commercialCaseId),
      ];
    }
  } else if (!hasWeeklyAllocation) {
    payload.provisionalOrder = payload.provisionalOrder.filter(
      (candidate) => candidate !== commercialCaseId,
    );
  }

  return parsePlanningPayload(payload);
}

export function applyPlanningPersonCapacityMutation(
  source: PlanningPayload,
  input: PlanningPersonCapacityMutation,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeUserIds.has(input.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");

  const payload = structuredClone(parsePlanningPayload(source));
  const index = payload.peopleCapacity.findIndex((person) => person.userId === input.userId);
  const next = {
    userId: input.userId,
    countsInMacroCapacity: input.countsInMacroCapacity,
    weeklySchedule: input.weeklySchedule ?? DEFAULT_WEEKLY_SCHEDULE,
  };

  if (index >= 0) payload.peopleCapacity[index] = next;
  else payload.peopleCapacity.push(next);

  return parsePlanningPayload(payload);
}

function effectiveSchedule(payload: PlanningPayload, userId: string) {
  return (
    payload.peopleCapacity.find((person) => person.userId === userId)?.weeklySchedule ??
    DEFAULT_WEEKLY_SCHEDULE
  );
}

export function applyPlanningAbsenceMutation(
  source: PlanningPayload,
  input: PlanningAbsenceMutation,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeUserIds.has(input.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");

  const payload = structuredClone(parsePlanningPayload(source));
  const sameDateIndex = payload.absences.findIndex(
    (absence) => absence.userId === input.userId && absence.date === input.date,
  );
  const byIdIndex = input.id
    ? payload.absences.findIndex((absence) => absence.id === input.id)
    : -1;
  const index = byIdIndex >= 0 ? byIdIndex : sameDateIndex;
  const next = {
    id: index >= 0 ? payload.absences[index].id : crypto.randomUUID(),
    userId: input.userId,
    type: input.type,
    date: input.date,
    hours: input.hours,
  };

  if (index >= 0) payload.absences[index] = next;
  else payload.absences.push(next);

  return parsePlanningPayload(payload);
}

export function applyPlanningFullWeekAbsenceMutation(
  source: PlanningPayload,
  input: PlanningFullWeekAbsenceMutation,
  activeUserIds: ReadonlySet<string>,
): PlanningPayload {
  if (!activeUserIds.has(input.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");

  const payload = structuredClone(parsePlanningPayload(source));
  const schedule = effectiveSchedule(payload, input.userId);
  const weekDates = isoWeekDates(input.week);
  const weekDateIds = new Set(weekDates.map((date) => date.toISOString().slice(0, 10)));

  payload.absences = payload.absences.filter(
    (absence) => absence.userId !== input.userId || !weekDateIds.has(absence.date),
  );

  for (const date of weekDates) {
    const hours = scheduleHoursForDate(schedule, date);
    if (hours <= 0) continue;
    payload.absences.push({
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      date: date.toISOString().slice(0, 10),
      hours,
    });
  }

  return parsePlanningPayload(payload);
}

export function applyPlanningDeleteAbsenceMutation(
  source: PlanningPayload,
  input: PlanningDeleteAbsenceMutation,
): PlanningPayload {
  const payload = structuredClone(parsePlanningPayload(source));
  payload.absences = payload.absences.filter((absence) => absence.id !== input.absenceId);
  return parsePlanningPayload(payload);
}
