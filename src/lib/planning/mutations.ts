import { z } from "zod";
import { DEFAULT_WEEKLY_SCHEDULE } from "./capacity";
import {
  allocationKey,
  parsePlanningPayload,
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
    action: z.literal("setPersonCapacity"),
    userId: z.string().uuid(),
    countsInMacroCapacity: z.boolean(),
    weeklySchedule: weekdayHoursMutationSchema,
  }),
]);

export const planningMacroMutationSchema = planningMutationSchema.options[0];
export type PlanningMutation = z.infer<typeof planningMutationSchema>;
export type PlanningMacroMutation = Extract<PlanningMutation, { action: "setMacroHours" }>;
export type PlanningPersonCapacityMutation = Extract<
  PlanningMutation,
  { action: "setPersonCapacity" }
>;

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
