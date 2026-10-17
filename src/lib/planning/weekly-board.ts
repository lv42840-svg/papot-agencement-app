import { z } from "zod";
import type { PlanningPayload } from "./domain";
import { parsePlanningPayload } from "./domain";
import { isoWeekDates } from "./capacity";
import { isoWeekKey } from "./time-markers";

export const weeklyBoardWeekSchema = z
  .string()
  .regex(/^(?:20\d\d|2100)-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "PLANNING_WEEK_INVALID")
  .refine((week) => {
    const firstDate = isoWeekDates(week)[0];
    return isoWeekKey(new Date(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), firstDate.getUTCDate(), 12)) === week;
  }, "PLANNING_WEEK_INVALID");

export const weeklyBoardAssignmentSchema = z.object({
  action: z.literal("setDailyAssignment"),
  week: weeklyBoardWeekSchema,
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "PLANNING_DAY_INVALID"),
  label: z.string().trim().max(160),
});

export type WeeklyBoardAssignmentInput = z.infer<typeof weeklyBoardAssignmentSchema>;

export function workingDaysOfWeek(week: string): string[] {
  weeklyBoardWeekSchema.parse(week);
  return isoWeekDates(week).slice(0, 5).map((date) => date.toISOString().slice(0, 10));
}

export function applyDailyAssignment(
  source: PlanningPayload,
  input: WeeklyBoardAssignmentInput,
  activePersonIds: ReadonlySet<string>,
  activeChantiers: readonly { id: string; name: string }[],
): PlanningPayload {
  weeklyBoardAssignmentSchema.parse(input);
  if (!activePersonIds.has(input.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");
  if (!workingDaysOfWeek(input.week).includes(input.date)) {
    throw new Error("PLANNING_DAY_OUTSIDE_WEEK");
  }
  const payload = structuredClone(parsePlanningPayload(source));
  const chantier = activeChantiers.find(
    (site) => site.name.trim().toLocaleLowerCase("fr-FR") === input.label.trim().toLocaleLowerCase("fr-FR"),
  );
  payload.dailyAssignments = payload.dailyAssignments.filter(
    (row) => row.userId !== input.userId || row.date !== input.date,
  );
  if (input.label.trim()) {
    payload.dailyAssignments.push({
      userId: input.userId,
      date: input.date,
      chantierId: chantier?.id ?? null,
      label: chantier?.name ?? input.label.trim(),
    });
  }
  return parsePlanningPayload(payload);
}

export type WeeklyBoardActivitySummary = {
  be: number;
  workshop: number;
  install: number;
  total: number;
};

export function weekActivityHours(
  rows: readonly { activities: readonly {
    activity: "BE" | "WORKSHOP" | "INSTALL";
    weeklyHours: Record<string, number>;
  }[] }[],
  week: string,
): WeeklyBoardActivitySummary {
  const result = { be: 0, workshop: 0, install: 0, total: 0 };
  for (const row of rows) {
    for (const activity of row.activities) {
      const hours = activity.weeklyHours[week] ?? 0;
      if (activity.activity === "BE") result.be += hours;
      if (activity.activity === "WORKSHOP") result.workshop += hours;
      if (activity.activity === "INSTALL") result.install += hours;
      result.total += hours;
    }
  }
  return result;
}
