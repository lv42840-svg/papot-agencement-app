import { z } from "zod";

const monthlyKeySchema = z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);

export const monthlyLaborCostInputSchema = z.object({
  action: z.literal("saveMonthlyLaborCost"),
  month: monthlyKeySchema,
  personId: z.string().uuid(),
  employerCostCents: z.number().int().nonnegative().max(100_000_000),
  workedHours: z
    .number()
    .finite()
    .positive()
    .max(744)
    .refine((value) => Number.isInteger(Math.round(value * 100)) && Math.abs(Math.round(value * 100) - value * 100) < 0.000001),
});

export const monthlyLaborCostRecordSchema = monthlyLaborCostInputSchema
  .omit({ action: true })
  .extend({
    updatedAt: z.string().datetime({ offset: true }),
    updatedBy: z.string().trim().min(1).max(120),
  });

const monthlyLaborCostsPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  records: z.array(monthlyLaborCostRecordSchema),
});

export type MonthlyLaborCostsPayload = z.infer<typeof monthlyLaborCostsPayloadSchema>;
export type MonthlyLaborCostInput = z.infer<typeof monthlyLaborCostInputSchema>;
export type MonthlyLaborCostRecord = z.infer<typeof monthlyLaborCostRecordSchema>;

export function parseMonthlyLaborCostsPayload(value: unknown): MonthlyLaborCostsPayload {
  if (value == null) return { schemaVersion: 1, records: [] };
  return monthlyLaborCostsPayloadSchema.parse(value);
}

export function parisCurrentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year + "-" + month;
}

export function assertClosedMonth(month: string, now = new Date()): void {
  monthlyKeySchema.parse(month);
  if (month >= parisCurrentMonth(now)) throw new Error("MONTHLY_LABOR_COST_MONTH_NOT_CLOSED");
}

export function monthlyHourlyRateEuro(record: Pick<MonthlyLaborCostRecord, "employerCostCents" | "workedHours">): number {
  return record.employerCostCents / 100 / record.workedHours;
}

export function saveMonthlyLaborCost(
  source: MonthlyLaborCostsPayload,
  input: MonthlyLaborCostInput,
  personIds: ReadonlySet<string>,
  actor: string,
  now = new Date(),
): MonthlyLaborCostsPayload {
  monthlyLaborCostInputSchema.parse(input);
  assertClosedMonth(input.month, now);
  if (!personIds.has(input.personId)) throw new Error("MONTHLY_LABOR_COST_PERSON_NOT_FOUND");

  const payload = structuredClone(parseMonthlyLaborCostsPayload(source));
  const next = {
    month: input.month,
    personId: input.personId,
    employerCostCents: input.employerCostCents,
    workedHours: input.workedHours,
    updatedAt: now.toISOString(),
    updatedBy: actor,
  };
  payload.records = payload.records.filter(
    (record) => record.month !== input.month || record.personId !== input.personId,
  );
  payload.records.push(next);
  return parseMonthlyLaborCostsPayload(payload);
}
