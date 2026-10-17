import { z } from "zod";
import { isoWeekDates } from "./capacity";
import { actualHoursKey, parsePlanningPayload, type PlanningPayload } from "./domain";
import { isoWeekKey } from "./time-markers";

const weekSchema = z
  .string()
  .regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "PLANNING_WEEK_INVALID")
  .refine((week) => {
    try {
      const monday = isoWeekDates(week)[0];
      return (
        isoWeekKey(
          new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 12),
        ) === week
      );
    } catch {
      return false;
    }
  }, "PLANNING_WEEK_INVALID");

export const actualHoursWeekSchema = weekSchema;

export const actualHoursRowSchema = z
  .object({
    action: z.literal("saveActualHoursRow"),
    chantierId: z.string().uuid(),
    userId: z.string().uuid(),
    week: weekSchema,
    be: z.number().finite().nonnegative().max(168),
    workshop: z.number().finite().nonnegative().max(168),
    install: z.number().finite().nonnegative().max(168),
  })
  .superRefine((input, ctx) => {
    if (input.be + input.workshop + input.install > 168) {
      ctx.addIssue({
        code: "custom",
        path: ["hours"],
        message: "PLANNING_ACTUAL_WEEK_TOTAL_INVALID",
      });
    }
  });

export type ActualHoursRowInput = z.infer<typeof actualHoursRowSchema>;

export function actualHoursByActivity(
  entries: readonly { activity: "BE" | "WORKSHOP" | "INSTALL"; hours: number }[],
) {
  const totals = { be: 0, workshop: 0, install: 0 };
  for (const entry of entries) {
    if (entry.activity === "BE") totals.be += entry.hours;
    if (entry.activity === "WORKSHOP") totals.workshop += entry.hours;
    if (entry.activity === "INSTALL") totals.install += entry.hours;
  }
  return totals;
}

export function applyActualHoursRow(
  source: PlanningPayload,
  input: ActualHoursRowInput,
  knownChantierIds: ReadonlySet<string>,
  knownPersonIds: ReadonlySet<string>,
): PlanningPayload {
  actualHoursRowSchema.parse(input);
  if (!knownChantierIds.has(input.chantierId)) throw new Error("PLANNING_CHANTIER_NOT_FOUND");
  if (!knownPersonIds.has(input.userId)) throw new Error("PLANNING_PERSON_NOT_FOUND");
  const payload = structuredClone(parsePlanningPayload(source));
  const activities = [
    ["BE", input.be],
    ["WORKSHOP", input.workshop],
    ["INSTALL", input.install],
  ] as const;
  for (const [activity, hours] of activities) {
    const key = actualHoursKey(input.chantierId, input.userId, activity, input.week);
    const index = payload.actualHours.findIndex(
      (entry) => actualHoursKey(entry.chantierId, entry.userId, entry.activity, entry.week) === key,
    );
    if (hours === 0) {
      if (index >= 0) payload.actualHours.splice(index, 1);
    } else {
      const next = {
        chantierId: input.chantierId,
        userId: input.userId,
        activity,
        week: input.week,
        hours,
      };
      if (index >= 0) payload.actualHours[index] = next;
      else payload.actualHours.push(next);
    }
  }
  const totalForPerson = payload.actualHours
    .filter((entry) => entry.week === input.week && entry.userId === input.userId)
    .reduce((sum, entry) => sum + entry.hours, 0);
  if (totalForPerson > 168) throw new Error("PLANNING_ACTUAL_PERSON_WEEK_TOO_HIGH");
  return parsePlanningPayload(payload);
}
