import { payrollWeekSignature } from "../planning/payroll-confirmation";
import { z } from "zod";
import { isoWeekDates, scheduleHoursForDate } from "../planning/capacity";
import { isoWeekKey } from "../planning/time-markers";
import { personPresentOnDate, type PlanningVisiblePerson } from "../planning/personnel";
import type { PlanningPayload } from "../planning/domain";

const monthSchema = z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);
const weekSchema = z.string().regex(/^\d{4}-W\d\d$/);
const heures = z.number().finite().nonnegative().max(168);
export const overtimeRulesSchema = z
  .object({ start25: heures, start50: heures })
  .refine((x) => x.start25 < x.start50, "PAYROLL_OVERTIME_THRESHOLDS_INVALID");
export type OvertimeRules = z.infer<typeof overtimeRulesSchema>;
export const DEFAULT_OVERTIME_RULES: OvertimeRules = { start25: 35, start50: 43 };

const weeklyRowSchema = z.object({
  week: weekSchema,
  hours: heures,
  baseHours: heures,
  absenceHours: heures,
  source: z.enum(["REAL", "CONTRACT"]),
  extra25: heures,
  extra50: heures,
});
const personRowSchema = z.object({
  personId: z.string().uuid(),
  name: z.string(),
  weeks: z.array(weeklyRowSchema),
  workedHours: heures.max(1000),
  overtime25: heures.max(1000),
  overtime50: heures.max(1000),
  vacationDays: z.number().nonnegative(),
  absences: z.array(
    z.object({ date: z.string(), type: z.enum(["VACATION", "SICK", "OTHER"]), hours: heures }),
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
export function parsePayrollPreparation(valeur: unknown): PayrollPreparationPayload {
  return prepPayloadSchema.parse(valeur ?? { schemaVersion: 1, months: [] });
}
export function getMonthState(contenu: PayrollPreparationPayload, mois: string): PayrollMonthState {
  monthSchema.parse(mois);
  return (
    contenu.months.find((ligneTableau) => ligneTableau.month === mois) ?? {
      month: mois,
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
export function payrollWeeks(mois: string): string[] {
  monthSchema.parse(mois);
  const [y, m] = mois.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  const resultat: string[] = [];
  for (let jour = 1; jour <= last.getUTCDate(); jour++) {
    const date = new Date(Date.UTC(y, m - 1, jour, 12));
    if (date.getUTCDay() === 0) resultat.push(isoWeekKey(date));
  }
  return resultat;
}

export function buildPayrollSummary(
  mois: string,
  planning: PlanningPayload,
  personnes: readonly PlanningVisiblePerson[],
  etat: PayrollMonthState,
  rules: OvertimeRules,
  maintenant = new Date(),
): PayrollSummary {
  const semaines = payrollWeeks(mois);
  const lignesTableau = personnes
    .flatMap((personne) => {
      const personWeeks = semaines.filter((semaine) =>
        isoWeekDates(semaine).some((d) =>
          personPresentOnDate(personne, d.toISOString().slice(0, 10)),
        ),
      );
      if (!personWeeks.length) return [];
      const relevantDates = new Set(
        personWeeks.flatMap((semaine) =>
          isoWeekDates(semaine).map((d) => d.toISOString().slice(0, 10)),
        ),
      );
      const absences = planning.absences.filter(
        (entree) => entree.userId === personne.userId && relevantDates.has(entree.date),
      );
      const weekRows = personWeeks.map((semaine) => {
        const dates = isoWeekDates(semaine);
        const baseHours = dates.reduce((total, date) => {
          const iso = date.toISOString().slice(0, 10);
          return (
            total +
            (personPresentOnDate(personne, iso)
              ? scheduleHoursForDate(personne.weeklySchedule, date)
              : 0)
          );
        }, 0);
        const absenceHours = absences
          .filter((entree) => dates.some((d) => d.toISOString().slice(0, 10) === entree.date))
          .reduce((total, ligneTableau) => total + ligneTableau.hours, 0);
        const realHours =
          planning.actualHours
            .filter((entree) => entree.userId === personne.userId && entree.week === semaine)
            .reduce((somme, ligneTableau) => somme + ligneTableau.hours, 0) +
          planning.indirectHours
            .filter((entree) => entree.userId === personne.userId && entree.week === semaine)
            .reduce((somme, ligneTableau) => somme + ligneTableau.hours, 0);
        const source =
          planning.payrollWeekConfirmations?.[personne.userId + ":" + semaine] ===
            payrollWeekSignature(planning, personne.userId, semaine) ||
          (!planning.payrollWeekConfirmations &&
            etat.validatedWeeks.includes(personne.userId + ":" + semaine))
            ? ("REAL" as const)
            : ("CONTRACT" as const);
        const selectionne = source === "REAL" ? realHours : Math.max(0, baseHours - absenceHours);
        const extra25 = Math.max(0, Math.min(selectionne, rules.start50) - rules.start25);
        const extra50 = Math.max(0, selectionne - rules.start50);
        return {
          week: semaine,
          source,
          baseHours,
          absenceHours,
          hours: selectionne,
          extra25,
          extra50,
        };
      });
      const vacationDays = absences
        .filter((ligneTableau) => ligneTableau.type === "VACATION")
        .reduce((somme, ligneTableau) => {
          const date = new Date(`${ligneTableau.date}T12:00:00Z`);
          const dailyHours = scheduleHoursForDate(personne.weeklySchedule, date);
          return somme + (dailyHours > 0 ? ligneTableau.hours / dailyHours : 0);
        }, 0);
      return [
        {
          personId: personne.userId,
          name: personne.displayName,
          weeks: weekRows,
          workedHours: weekRows.reduce((somme, ligneTableau) => somme + ligneTableau.hours, 0),
          overtime25: weekRows.reduce((somme, ligneTableau) => somme + ligneTableau.extra25, 0),
          overtime50: weekRows.reduce((somme, ligneTableau) => somme + ligneTableau.extra50, 0),
          vacationDays: Math.round(vacationDays * 100) / 100,
          absences: absences.map((entree) => ({
            date: entree.date,
            type: entree.type,
            hours: entree.hours,
          })),
          contractWeeks: weekRows
            .filter((ligneTableau) => ligneTableau.source === "CONTRACT")
            .map((ligneTableau) => ligneTableau.week),
          note: etat.notes[personne.userId] ?? "",
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return summarySchema.parse({
    month: mois,
    rules,
    rows: lignesTableau,
    generatedAt: maintenant.toISOString(),
  });
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
  personnes: readonly PlanningVisiblePerson[],
  auteur: string,
  maintenant = new Date(),
): PayrollPreparationPayload {
  const saisie = mutationSchema.parse(raw);
  const resultat = structuredClone(parsePayrollPreparation(original));
  const etat = getMonthState(resultat, saisie.month);
  if (etat.revision !== saisie.expectedRevision)
    throw new Error("PAYROLL_PREPARATION_VERSION_CONFLICT");
  if (etat.status === "PREPARED" && saisie.action !== "reopen")
    throw new Error("PAYROLL_PREPARATION_LOCKED");
  const action = saisie.action;
  if (action === "setNote") {
    if (!personnes.some((p) => p.userId === saisie.personId))
      throw new Error("PAYROLL_PERSON_NOT_FOUND");
    etat.notes[saisie.personId] = saisie.note;
  } else if (action === "setWeekValidated") {
    if (
      !personnes.some((p) => p.userId === saisie.personId) ||
      !payrollWeeks(saisie.month).includes(saisie.week)
    )
      throw new Error("PAYROLL_WEEK_INVALID");
    const cle = saisie.personId + ":" + saisie.week;
    etat.validatedWeeks = saisie.validated
      ? [...new Set([...etat.validatedWeeks, cle])]
      : etat.validatedWeeks.filter((x) => x !== cle);
  } else if (action === "setOvertimeRules") {
    resultat.rules = saisie.rules;
  } else if (action === "validate") {
    const summary = buildPayrollSummary(
      saisie.month,
      planning,
      personnes,
      etat,
      resultat.rules,
      maintenant,
    );
    const precedent = etat.versions.at(-1)?.summary;
    if (etat.status === "REOPENED" && precedent && sameData(precedent, summary))
      throw new Error("PAYROLL_PREPARATION_UNCHANGED");
    etat.versions.push({
      number: etat.versions.length + 1,
      validatedAt: maintenant.toISOString(),
      validatedBy: auteur,
      summary,
      reopenReason: etat.reopenReason,
    });
    etat.status = "PREPARED";
    etat.reopenReason = null;
  } else if (action === "reopen") {
    if (etat.status !== "PREPARED") throw new Error("PAYROLL_PREPARATION_NOT_PREPARED");
    etat.status = "REOPENED";
    etat.reopenReason = saisie.reason;
  } else if (action === "restore") {
    if (etat.status !== "REOPENED" || !etat.versions.length)
      throw new Error("PAYROLL_PREPARATION_NOT_REOPENED");
    const courant = buildPayrollSummary(
      saisie.month,
      planning,
      personnes,
      etat,
      resultat.rules,
      maintenant,
    );
    if (!sameData(courant, etat.versions.at(-1)!.summary))
      throw new Error("PAYROLL_PREPARATION_CHANGED");
    etat.status = "PREPARED";
    etat.reopenReason = null;
  }
  etat.eventLog.push({
    action,
    at: maintenant.toISOString(),
    by: auteur,
    reason: action === "reopen" ? saisie.reason : null,
  });
  etat.revision++;
  resultat.months = [...resultat.months.filter((element) => element.month !== saisie.month), etat];
  return prepPayloadSchema.parse(resultat);
}

export function payrollDifferences(precedent: PayrollSummary, courant: PayrollSummary) {
  const oldRows = new Map(
    precedent.rows.map((ligneTableau) => [ligneTableau.personId, ligneTableau]),
  );
  const newRows = new Map(
    courant.rows.map((ligneTableau) => [ligneTableau.personId, ligneTableau]),
  );
  const identifiants = new Set([...oldRows.keys(), ...newRows.keys()]);
  return [...identifiants].flatMap((id) => {
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
