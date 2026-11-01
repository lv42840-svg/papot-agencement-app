import { payrollWeekSignature } from "../planning/payroll-confirmation";
import { z } from "zod";
import { isoWeekDates, scheduleHoursForDate } from "../planning/capacity";
import { isoWeekKey } from "../planning/time-markers";
import { personPresentOnDate, type PlanningVisiblePerson } from "../planning/personnel";
import type { PlanningPayload } from "../planning/domain";

const monthSchema = z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);
const weekSchema = z.string().regex(/^\d{4}-W\d\d$/);
const hours = z.number().finite().nonnegative().max(168);
export const overtimeRulesSchema = z
  .object({ start25: hours, start50: hours })
  .refine((x) => x.start25 < x.start50, "PAYROLL_OVERTIME_THRESHOLDS_INVALID");
export type OvertimeRules = z.infer<typeof overtimeRulesSchema>;
export const DEFAULT_OVERTIME_RULES: OvertimeRules = { start25: 35, start50: 43 };

const weeklyRowSchema = z.object({
  week: weekSchema,
  hours: hours,
  baseHours: hours,
  absenceHours: hours,
  source: z.enum(["REAL", "CONTRACT"]),
  extra25: hours,
  extra50: hours,
});
const personRowSchema = z.object({
  personId: z.string().uuid(),
  name: z.string(),
  weeks: z.array(weeklyRowSchema),
  workedHours: hours.max(1000),
  overtime25: hours.max(1000),
  overtime50: hours.max(1000),
  vacationDays: z.number().nonnegative(),
  absences: z.array(
    z.object({ date: z.string(), type: z.enum(["VACATION", "SICK", "OTHER"]), hours }),
  ),
  contractWeeks: z.array(weekSchema),
  note: z.string().max(3000),
});
const summarySchema = z.object({
  month: monthSchema,
  rules: overtimeRulesSchema,
  rows: z.array(personRowSchema),
  generatedAt: z.string().datetime(),
});
export type PayrollSummary = z.infer<typeof summarySchema>;

const versionSchema = z.object({
  number: z.number().int().positive(),
  validatedAt: z.string().datetime(),
  validatedBy: z.string().min(1),
  summary: summarySchema,
  reopenReason: z.string().nullable(),
});
const monthStateSchema = z.object({
  month: monthSchema,
  status: z.enum(["PREPARING", "PREPARED", "REOPENED"]),
  revision: z.number().int().nonnegative(),
  validatedWeeks: z.array(z.string()),
  notes: z.record(z.string()),
  versions: z.array(versionSchema),
  reopenReason: z.string().nullable(),
  eventLog: z.array(
    z.object({
      action: z.string(),
      at: z.string().datetime(),
      by: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});
export type PayrollMonthState = z.infer<typeof monthStateSchema>;
const prepPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  templateBase64: z.string().max(7000000).optional(),
  rules: overtimeRulesSchema.default(DEFAULT_OVERTIME_RULES),
  months: z.array(monthStateSchema),
});
export type PayrollPreparationPayload = z.infer<typeof prepPayloadSchema>;
export function parsePayrollPreparation(value: unknown): PayrollPreparationPayload {
  return prepPayloadSchema.parse(value ?? { schemaVersion: 1, months: [] });
}
export function getMonthState(
  payload: PayrollPreparationPayload,
  month: string,
): PayrollMonthState {
  monthSchema.parse(month);
  return (
    payload.months.find((row) => row.month === month) ?? {
      month,
      status: "PREPARING",
      revision: 0,
      validatedWeeks: [],
      notes: {},
      versions: [],
      reopenReason: null,
      eventLog: [],
    }
  );
}

/** All seven days of a week belong to the month of its Sunday, even across New Year. */
export function payrollWeeks(month: string): string[] {
  monthSchema.parse(month);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  const result: string[] = [];
  for (let day = 1; day <= last.getUTCDate(); day++) {
    const date = new Date(Date.UTC(y, m - 1, day, 12));
    if (date.getUTCDay() === 0) result.push(isoWeekKey(date));
  }
  return result;
}

export function buildPayrollSummary(
  month: string,
  planning: PlanningPayload,
  people: readonly PlanningVisiblePerson[],
  state: PayrollMonthState,
  rules: OvertimeRules,
  now = new Date(),
): PayrollSummary {
  const weeks = payrollWeeks(month);
  const rows = people
    .flatMap((person) => {
      const personWeeks = weeks.filter((week) =>
        isoWeekDates(week).some((d) => personPresentOnDate(person, d.toISOString().slice(0, 10))),
      );
      if (!personWeeks.length) return [];
      const relevantDates = new Set(
        personWeeks.flatMap((week) => isoWeekDates(week).map((d) => d.toISOString().slice(0, 10))),
      );
      const absences = planning.absences.filter(
        (entry) => entry.userId === person.userId && relevantDates.has(entry.date),
      );
      const weekRows = personWeeks.map((week) => {
        const dates = isoWeekDates(week);
        const baseHours = dates.reduce((total, date) => {
          const iso = date.toISOString().slice(0, 10);
          return (
            total +
            (personPresentOnDate(person, iso)
              ? scheduleHoursForDate(person.weeklySchedule, date)
              : 0)
          );
        }, 0);
        const absenceHours = absences
          .filter((entry) => dates.some((d) => d.toISOString().slice(0, 10) === entry.date))
          .reduce((total, row) => total + row.hours, 0);
        const realHours =
          planning.actualHours
            .filter((entry) => entry.userId === person.userId && entry.week === week)
            .reduce((sum, row) => sum + row.hours, 0) +
          planning.indirectHours
            .filter((entry) => entry.userId === person.userId && entry.week === week)
            .reduce((sum, row) => sum + row.hours, 0);
        const source =
          planning.payrollWeekConfirmations?.[person.userId + ":" + week] ===
            payrollWeekSignature(planning, person.userId, week) ||
          (!planning.payrollWeekConfirmations &&
            state.validatedWeeks.includes(person.userId + ":" + week))
            ? ("REAL" as const)
            : ("CONTRACT" as const);
        const selected = source === "REAL" ? realHours : Math.max(0, baseHours - absenceHours);
        const extra25 = Math.max(0, Math.min(selected, rules.start50) - rules.start25);
        const extra50 = Math.max(0, selected - rules.start50);
        return { week, source, baseHours, absenceHours, hours: selected, extra25, extra50 };
      });
      const vacationDays = absences
        .filter((row) => row.type === "VACATION")
        .reduce((sum, row) => {
          const date = new Date(`${row.date}T12:00:00Z`);
          const dailyHours = scheduleHoursForDate(person.weeklySchedule, date);
          return sum + (dailyHours > 0 ? row.hours / dailyHours : 0);
        }, 0);
      return [
        {
          personId: person.userId,
          name: person.displayName,
          weeks: weekRows,
          workedHours: weekRows.reduce((sum, row) => sum + row.hours, 0),
          overtime25: weekRows.reduce((sum, row) => sum + row.extra25, 0),
          overtime50: weekRows.reduce((sum, row) => sum + row.extra50, 0),
          vacationDays: Math.round(vacationDays * 100) / 100,
          absences: absences.map((entry) => ({
            date: entry.date,
            type: entry.type,
            hours: entry.hours,
          })),
          contractWeeks: weekRows.filter((row) => row.source === "CONTRACT").map((row) => row.week),
          note: state.notes[person.userId] ?? "",
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return summarySchema.parse({ month, rules, rows, generatedAt: now.toISOString() });
}

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setNote"),
    month: monthSchema,
    expectedRevision: z.number().int().nonnegative(),
    personId: z.string().uuid(),
    note: z.string().max(3000),
  }),
  z.object({
    action: z.literal("setWeekValidated"),
    month: monthSchema,
    expectedRevision: z.number().int().nonnegative(),
    personId: z.string().uuid(),
    week: weekSchema,
    validated: z.boolean(),
  }),
  z.object({
    action: z.literal("setOvertimeRules"),
    month: monthSchema,
    expectedRevision: z.number().int().nonnegative(),
    rules: overtimeRulesSchema,
  }),
  z.object({
    action: z.literal("validate"),
    month: monthSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("reopen"),
    month: monthSchema,
    expectedRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(1500),
  }),
  z.object({
    action: z.literal("restore"),
    month: monthSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
]);
export type PayrollPreparationMutation = z.input<typeof mutationSchema>;

function sameData(a: PayrollSummary, b: PayrollSummary): boolean {
  return (
    JSON.stringify({ rows: a.rows, rules: a.rules }) ===
    JSON.stringify({ rows: b.rows, rules: b.rules })
  );
}
export function mutatePayrollPreparation(
  original: PayrollPreparationPayload,
  raw: PayrollPreparationMutation,
  planning: PlanningPayload,
  people: readonly PlanningVisiblePerson[],
  actor: string,
  now = new Date(),
): PayrollPreparationPayload {
  const input = mutationSchema.parse(raw);
  const result = structuredClone(parsePayrollPreparation(original));
  const state = getMonthState(result, input.month);
  if (state.revision !== input.expectedRevision)
    throw new Error("PAYROLL_PREPARATION_VERSION_CONFLICT");
  if (state.status === "PREPARED" && input.action !== "reopen")
    throw new Error("PAYROLL_PREPARATION_LOCKED");
  const action = input.action;
  if (action === "setNote") {
    if (!people.some((p) => p.userId === input.personId))
      throw new Error("PAYROLL_PERSON_NOT_FOUND");
    state.notes[input.personId] = input.note;
  } else if (action === "setWeekValidated") {
    if (
      !people.some((p) => p.userId === input.personId) ||
      !payrollWeeks(input.month).includes(input.week)
    )
      throw new Error("PAYROLL_WEEK_INVALID");
    const key = input.personId + ":" + input.week;
    state.validatedWeeks = input.validated
      ? [...new Set([...state.validatedWeeks, key])]
      : state.validatedWeeks.filter((x) => x !== key);
  } else if (action === "setOvertimeRules") {
    result.rules = input.rules;
  } else if (action === "validate") {
    const summary = buildPayrollSummary(input.month, planning, people, state, result.rules, now);
    const previous = state.versions.at(-1)?.summary;
    if (state.status === "REOPENED" && previous && sameData(previous, summary))
      throw new Error("PAYROLL_PREPARATION_UNCHANGED");
    state.versions.push({
      number: state.versions.length + 1,
      validatedAt: now.toISOString(),
      validatedBy: actor,
      summary,
      reopenReason: state.reopenReason,
    });
    state.status = "PREPARED";
    state.reopenReason = null;
  } else if (action === "reopen") {
    if (state.status !== "PREPARED") throw new Error("PAYROLL_PREPARATION_NOT_PREPARED");
    state.status = "REOPENED";
    state.reopenReason = input.reason;
  } else if (action === "restore") {
    if (state.status !== "REOPENED" || !state.versions.length)
      throw new Error("PAYROLL_PREPARATION_NOT_REOPENED");
    const current = buildPayrollSummary(input.month, planning, people, state, result.rules, now);
    if (!sameData(current, state.versions.at(-1)!.summary))
      throw new Error("PAYROLL_PREPARATION_CHANGED");
    state.status = "PREPARED";
    state.reopenReason = null;
  }
  state.eventLog.push({
    action,
    at: now.toISOString(),
    by: actor,
    reason: action === "reopen" ? input.reason : null,
  });
  state.revision++;
  result.months = [...result.months.filter((item) => item.month !== input.month), state];
  return prepPayloadSchema.parse(result);
}

export function payrollDifferences(previous: PayrollSummary, current: PayrollSummary) {
  const oldRows = new Map(previous.rows.map((row) => [row.personId, row]));
  const newRows = new Map(current.rows.map((row) => [row.personId, row]));
  const ids = new Set([...oldRows.keys(), ...newRows.keys()]);
  return [...ids].flatMap((id) => {
    const before = oldRows.get(id);
    const after = newRows.get(id);
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    if (!before || !after)
      changes.push({ field: "presence", before: before?.name ?? null, after: after?.name ?? null });
    else {
      const fields = [
        "workedHours",
        "overtime25",
        "overtime50",
        "vacationDays",
        "note",
        "absences",
        "contractWeeks",
        "weeks",
      ] as const;
      for (const field of fields) {
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field]))
          changes.push({ field, before: before[field], after: after[field] });
      }
    }
    return changes.length ? [{ personId: id, name: after?.name ?? before!.name, changes }] : [];
  });
}
