import type { PlanningPersonCapacity } from "../planning/capacity";
import type { PlanningIndirectHours } from "../planning/domain";
import { monthlySharesForWeek } from "./chantier-labor-cost";
import { resolveLaborCostForWorkedMonth, type MonthlyLaborCostRecord } from "./monthly-labor-costs";

export type IndirectLaborCostsPeriod = {
  savHours: number;
  generalHours: number;
  savCostCents: number | null;
  generalCostCents: number | null;
  totalCostCents: number | null;
  provisional: boolean;
};

type InternalBucket = {
  hours: number;
  costCents: number;
  complete: boolean;
};

function sumHours(heures: number): number {
  return Math.round(heures * 100) / 100;
}

/**
 * SAV and general expenses are company-wide labor costs, never chantier costs.
 * Weeks spanning months use the same employee working-day prorata as chantier payroll.
 * Missing payroll values yield null costs, never an underestimated subtotal.
 */
export function calculateIndirectLaborCostsForPeriod(
  periode: string,
  entrees: readonly PlanningIndirectHours[],
  enregistrements: readonly MonthlyLaborCostRecord[],
  capacitesPersonnes: readonly PlanningPersonCapacity[],
  maintenant = new Date(),
): IndirectLaborCostsPeriod {
  const parPersonneMois = new Map(
    enregistrements.map((enregistrement) => [
      enregistrement.personId + ":" + enregistrement.month,
      enregistrement,
    ]),
  );
  const horaires = new Map(
    capacitesPersonnes.map((personne) => [personne.userId, personne.weeklySchedule]),
  );
  let provisoire = false;
  const compartiments: Record<PlanningIndirectHours["category"], InternalBucket> = {
    SAV: { hours: 0, costCents: 0, complete: true },
    GENERAL: { hours: 0, costCents: 0, complete: true },
  };

  for (const entree of entrees) {
    if (entree.hours <= 0) continue;
    for (const repartition of monthlySharesForWeek(entree.week, horaires.get(entree.userId))) {
      if (!repartition.month.startsWith(periode)) continue;
      const compartiment = compartiments[entree.category];
      const heures = entree.hours * repartition.fraction;
      compartiment.hours += heures;
      const coutResolue = resolveLaborCostForWorkedMonth(
        entree.userId,
        repartition.month,
        parPersonneMois,
        maintenant,
      );
      if (!coutResolue) {
        compartiment.complete = false;
      } else {
        provisoire ||= coutResolue.provisional;
        compartiment.costCents +=
          heures * (coutResolue.record.employerCostCents / coutResolue.record.workedHours);
      }
    }
  }

  const coutSavCentimes = compartiments.SAV.complete
    ? Math.round(compartiments.SAV.costCents)
    : null;
  const coutFraisGenerauxCentimes = compartiments.GENERAL.complete
    ? Math.round(compartiments.GENERAL.costCents)
    : null;

  return {
    savHours: sumHours(compartiments.SAV.hours),
    generalHours: sumHours(compartiments.GENERAL.hours),
    savCostCents: coutSavCentimes,
    generalCostCents: coutFraisGenerauxCentimes,
    provisional: provisoire && coutSavCentimes !== null && coutFraisGenerauxCentimes !== null,
    totalCostCents:
      coutSavCentimes === null || coutFraisGenerauxCentimes === null
        ? null
        : coutSavCentimes + coutFraisGenerauxCentimes,
  };
}

/**
 * Preliminary company-margin indicator: planned margin from confirmed contracts
 * less realized SAV and overhead labor. Not the accounting result; actual purchases,
 * invoices, and other overhead are not included.
 */
export function calculateIndicativeCompanyMarginCents(
  margePrevueCentimes: number | null,
  coutsIndirects: IndirectLaborCostsPeriod,
): number | null {
  return margePrevueCentimes === null || coutsIndirects.totalCostCents === null
    ? null
    : margePrevueCentimes - coutsIndirects.totalCostCents;
}
