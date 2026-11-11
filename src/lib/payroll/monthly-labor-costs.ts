import { editHistorySchema } from "../edit-history";
import { z } from "zod";

const monthlyKeySchema = z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);
const hoursSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(744)
  .refine(
    (valeur) => Math.abs(Math.round(valeur * 100) - valeur * 100) < 0.000001,
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

export function parseMonthlyLaborCostsPayload(valeur: unknown): MonthlyLaborCostsPayload {
  if (valeur == null) return { schemaVersion: 1, records: [], history: [] };
  return monthlyLaborCostsPayloadSchema.parse(valeur);
}

export function parisCurrentMonth(maintenant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(maintenant);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export function previousMonthKey(mois: string): string {
  monthlyKeySchema.parse(mois);
  const annee = Number(mois.slice(0, 4));
  const number = Number(mois.slice(5));
  return number === 1 ? `${annee - 1}-12` : `${annee}-${String(number - 1).padStart(2, "0")}`;
}

export function resolveLaborCostForWorkedMonth(
  personId: string,
  workedMonth: string,
  byPersonMonth: ReadonlyMap<string, MonthlyLaborCostRecord>,
  maintenant = new Date(),
): { record: MonthlyLaborCostRecord; provisional: boolean } | null {
  const provisional = workedMonth === parisCurrentMonth(maintenant);
  const courant = byPersonMonth.get(`${personId}:${workedMonth}`);
  if (provisional && courant?.sourceType === "HOLDING" && courant.workedHours > 0) {
    return { record: courant, provisional: true };
  }
  const recordMonth = provisional ? previousMonthKey(workedMonth) : workedMonth;
  const enregistrement = byPersonMonth.get(`${personId}:${recordMonth}`);
  return enregistrement && enregistrement.workedHours > 0
    ? { record: enregistrement, provisional }
    : null;
}

export function assertClosedMonth(mois: string, maintenant = new Date()): void {
  monthlyKeySchema.parse(mois);
  if (mois >= parisCurrentMonth(maintenant)) throw new Error("MONTHLY_LABOR_COST_MONTH_NOT_CLOSED");
}

/** Zero hours retains the whole charge, but does not manufacture an hourly rate. */
export function monthlyHourlyRateEuro(
  enregistrement: Pick<MonthlyLaborCostRecord, "employerCostCents" | "workedHours">,
): number | null {
  return enregistrement.workedHours > 0
    ? enregistrement.employerCostCents / 100 / enregistrement.workedHours
    : null;
}

export function saveMonthlyLaborCost(
  source: MonthlyLaborCostsPayload,
  rawInput: MonthlyLaborCostInput,
  personIds: ReadonlySet<string>,
  auteur: string,
  maintenant = new Date(),
): MonthlyLaborCostsPayload {
  const saisie = monthlyLaborCostInputSchema.parse(rawInput);
  if (saisie.sourceType === "HOLDING") {
    if (saisie.month > parisCurrentMonth(maintenant))
      throw new Error("MONTHLY_LABOR_COST_FUTURE_MONTH");
  } else assertClosedMonth(saisie.month, maintenant);
  if (!personIds.has(saisie.personId)) throw new Error("MONTHLY_LABOR_COST_PERSON_NOT_FOUND");
  const contenu = structuredClone(parseMonthlyLaborCostsPayload(source));
  const existing =
    contenu.records.find(
      (enregistrement) =>
        enregistrement.month === saisie.month && enregistrement.personId === saisie.personId,
    ) ?? null;
  if (
    saisie.expectedRevision !== undefined &&
    saisie.expectedRevision !== (existing?.revision ?? null)
  ) {
    throw new Error("MONTHLY_LABOR_COST_VERSION_CONFLICT");
  }
  const suivant = monthlyLaborCostRecordSchema.parse({
    month: saisie.month,
    personId: saisie.personId,
    employerCostCents: saisie.employerCostCents,
    workedHours: saisie.workedHours,
    sourceType: saisie.sourceType,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: maintenant.toISOString(),
    updatedBy: auteur,
  });
  if (
    existing &&
    existing.employerCostCents === suivant.employerCostCents &&
    existing.workedHours === suivant.workedHours &&
    existing.sourceType === suivant.sourceType
  )
    return contenu;
  contenu.records = contenu.records.filter(
    (enregistrement) =>
      enregistrement.month !== saisie.month || enregistrement.personId !== saisie.personId,
  );
  contenu.records.push(suivant);
  contenu.history.push({
    month: saisie.month,
    personId: saisie.personId,
    previous: existing,
    next: suivant,
    at: maintenant.toISOString(),
    by: auteur,
  });
  return parseMonthlyLaborCostsPayload(contenu);
}
