import { editHistorySchema } from "../edit-history";
import { z } from "zod";

const monthlyKeySchema = z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);
const hoursSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(744)
  .refine(
    (value) => Math.abs(Math.round(value * 100) - value * 100) < 0.000001,
    "MONTHLY_LABOR_COST_HOURS_INVALID",
  );
export const laborCostSourceSchema = z.enum(["SALARY", "HOLDING"]);

export const monthlyLaborCostInputSchema = z.object({
  action: z.literal("saveMonthlyLaborCost"),
  month: monthlyKeySchema,
  personId: z.string().uuid(),
  employerCostCents: z.number().int().nonnegative().max(100_000_000),
  workedHours: hoursSchema,
  sourceType: laborCostSourceSchema.default("SALARY"),
  expectedRevision: z.number().int().nonnegative().nullable().optional(),
});

export const monthlyLaborCostRecordSchema = monthlyLaborCostInputSchema
  .omit({ action: true, expectedRevision: true })
  .extend({
    revision: z.number().int().positive().default(1),
    updatedAt: z.string().datetime({ offset: true }),
    updatedBy: z.string().trim().min(1).max(120),
  });

const historyEntrySchema = z.object({
  month: monthlyKeySchema,
  personId: z.string().uuid(),
  previous: monthlyLaborCostRecordSchema.nullable(),
  next: monthlyLaborCostRecordSchema,
  at: z.string().datetime({ offset: true }),
  by: z.string().min(1),
});

const monthlyLaborCostsPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  editRevisions: z.record(z.number().int().nonnegative()).optional(),
  editHistory: z.array(editHistorySchema).optional(),
  records: z.array(monthlyLaborCostRecordSchema),
  history: z.array(historyEntrySchema).default([]),
});

export type MonthlyLaborCostsPayload = z.infer<typeof monthlyLaborCostsPayloadSchema>;
export type MonthlyLaborCostInput = z.input<typeof monthlyLaborCostInputSchema>;
export type MonthlyLaborCostRecord = z.input<typeof monthlyLaborCostRecordSchema>;

export function parseMonthlyLaborCostsPayload(value: unknown): MonthlyLaborCostsPayload {
  if (value == null) return { schemaVersion: 1, records: [], history: [] };
  return monthlyLaborCostsPayloadSchema.parse(value);
}

export function parisCurrentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export function previousMonthKey(month: string): string {
  monthlyKeySchema.parse(month);
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

export function resolveLaborCostForWorkedMonth(
  personId: string,
  workedMonth: string,
  byPersonMonth: ReadonlyMap<string, MonthlyLaborCostRecord>,
  now = new Date(),
): { record: MonthlyLaborCostRecord; provisional: boolean } | null {
  const provisional = workedMonth === parisCurrentMonth(now);
  const current = byPersonMonth.get(`${personId}:${workedMonth}`);
  if (provisional && current?.sourceType === "HOLDING" && current.workedHours > 0) {
    return { record: current, provisional: true };
  }
  const recordMonth = provisional ? previousMonthKey(workedMonth) : workedMonth;
  const record = byPersonMonth.get(`${personId}:${recordMonth}`);
  return record && record.workedHours > 0 ? { record, provisional } : null;
}

export function assertClosedMonth(month: string, now = new Date()): void {
  monthlyKeySchema.parse(month);
  if (month >= parisCurrentMonth(now)) throw new Error("MONTHLY_LABOR_COST_MONTH_NOT_CLOSED");
}

/** Zero hours retains the whole charge, but does not manufacture an hourly rate. */
export function monthlyHourlyRateEuro(
  record: Pick<MonthlyLaborCostRecord, "employerCostCents" | "workedHours">,
): number | null {
  return record.workedHours > 0 ? record.employerCostCents / 100 / record.workedHours : null;
}

export function saveMonthlyLaborCost(
  source: MonthlyLaborCostsPayload,
  rawInput: MonthlyLaborCostInput,
  personIds: ReadonlySet<string>,
  actor: string,
  now = new Date(),
): MonthlyLaborCostsPayload {
  const input = monthlyLaborCostInputSchema.parse(rawInput);
  if (input.sourceType === "HOLDING") {
    if (input.month > parisCurrentMonth(now)) throw new Error("MONTHLY_LABOR_COST_FUTURE_MONTH");
  } else assertClosedMonth(input.month, now);
  if (!personIds.has(input.personId)) throw new Error("MONTHLY_LABOR_COST_PERSON_NOT_FOUND");
  const payload = structuredClone(parseMonthlyLaborCostsPayload(source));
  const existing =
    payload.records.find(
      (record) => record.month === input.month && record.personId === input.personId,
    ) ?? null;
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== (existing?.revision ?? null)
  ) {
    throw new Error("MONTHLY_LABOR_COST_VERSION_CONFLICT");
  }
  const next = monthlyLaborCostRecordSchema.parse({
    month: input.month,
    personId: input.personId,
    employerCostCents: input.employerCostCents,
    workedHours: input.workedHours,
    sourceType: input.sourceType,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now.toISOString(),
    updatedBy: actor,
  });
  if (
    existing &&
    existing.employerCostCents === next.employerCostCents &&
    existing.workedHours === next.workedHours &&
    existing.sourceType === next.sourceType
  )
    return payload;
  payload.records = payload.records.filter(
    (record) => record.month !== input.month || record.personId !== input.personId,
  );
  payload.records.push(next);
  payload.history.push({
    month: input.month,
    personId: input.personId,
    previous: existing,
    next,
    at: now.toISOString(),
    by: actor,
  });
  return parseMonthlyLaborCostsPayload(payload);
}
