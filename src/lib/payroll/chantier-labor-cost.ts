import { DEFAULT_WEEKLY_SCHEDULE, isoWeekDates, scheduleHoursForDate } from "../planning/capacity";
import type { PlanningActualHours } from "../planning/domain";
import type { PlanningPersonCapacity } from "@/lib/planning/capacity";
import { resolveLaborCostForWorkedMonth, type MonthlyLaborCostRecord } from "./monthly-labor-costs";

/**
 * Weekly actual hours are recorded without dates. For a week spanning two months,
 * distribute those hours using the employee's standard working-day capacity.
 * Holidays are excluded. When the standard capacity is zero, use weekdays equally.
 * This is an estimate: no daily distribution is invented or written back to planning.
 */
export function monthlySharesForWeek(
  semaine: string,
  horaire: PlanningPersonCapacity["weeklySchedule"] = DEFAULT_WEEKLY_SCHEDULE,
): Array<{ month: string; fraction: number }> {
  const dates = isoWeekDates(semaine);
  let poids = dates.map((date) => scheduleHoursForDate(horaire, date));
  if (poids.every((valeur) => valeur === 0)) {
    poids = dates.map((date) => {
      const jour = date.getUTCDay();
      return jour > 0 && jour < 6 ? 1 : 0;
    });
  }
  const sommePoids = poids.reduce((somme, valeur) => somme + valeur, 0);
  const parMois = new Map<string, number>();
  dates.forEach((date, indice) => {
    const mois = date.toISOString().slice(0, 7);
    parMois.set(mois, (parMois.get(mois) ?? 0) + poids[indice] / sommePoids);
  });
  return [...parMois]
    .filter(([, fraction]) => fraction > 0)
    .map(([mois, fraction]) => ({ month: mois, fraction }));
}

/**
 * Returns null rather than understating real labor costs whenever a contributing
 * person's monthly employer-cost record is missing. Original hours are untouched.
 * One rounding to whole cents is applied at the chantier level.
 */
export type ChantierLaborCostEstimate = {
  costCents: number | null;
  provisional: boolean;
};

export function calculateChantierLaborCostEstimate(
  idChantier: string,
  heuresReelles: readonly PlanningActualHours[],
  enregistrements: readonly MonthlyLaborCostRecord[],
  capacitesPersonnes: readonly PlanningPersonCapacity[],
  maintenant = new Date(),
): ChantierLaborCostEstimate {
  const entrees = heuresReelles.filter(
    (ligne) => ligne.chantierId === idChantier && ligne.hours > 0,
  );
  if (entrees.length === 0) {
    return { costCents: 0, provisional: false };
  }

  const parPersonneMois = new Map(
    enregistrements.map((enregistrement) => [
      enregistrement.personId + ":" + enregistrement.month,
      enregistrement,
    ]),
  );
  const horairesParPersonne = new Map(
    capacitesPersonnes.map((personne) => [personne.userId, personne.weeklySchedule]),
  );
  let totalCentimes = 0;
  let provisoire = false;

  for (const entree of entrees) {
    for (const repartition of monthlySharesForWeek(
      entree.week,
      horairesParPersonne.get(entree.userId),
    )) {
      const coutResolue = resolveLaborCostForWorkedMonth(
        entree.userId,
        repartition.month,
        parPersonneMois,
        maintenant,
      );
      if (!coutResolue) {
        return { costCents: null, provisional: false };
      }
      provisoire ||= coutResolue.provisional;
      totalCentimes +=
        entree.hours *
        repartition.fraction *
        (coutResolue.record.employerCostCents / coutResolue.record.workedHours);
    }
  }
  return {
    costCents: Math.round(totalCentimes),
    provisional: provisoire,
  };
}

/** Compatibility helper for callers that only require the monetary total. */
export function calculateChantierLaborCostCents(
  idChantier: string,
  heuresReelles: readonly PlanningActualHours[],
  enregistrements: readonly MonthlyLaborCostRecord[],
  capacitesPersonnes: readonly PlanningPersonCapacity[],
  maintenant = new Date(),
): number | null {
  return calculateChantierLaborCostEstimate(
    idChantier,
    heuresReelles,
    enregistrements,
    capacitesPersonnes,
    maintenant,
  ).costCents;
}
