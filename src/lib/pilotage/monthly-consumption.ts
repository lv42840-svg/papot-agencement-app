import type { PlanningPayload } from "../planning/domain";
import { monthlySharesForWeek } from "../payroll/chantier-labor-cost";
import {
  resolveLaborCostForWorkedMonth,
  type MonthlyLaborCostRecord,
} from "../payroll/monthly-labor-costs";
import { financialMonthSchema } from "./monthly-financial-result";

export type MonthlyConsumptionBucket = {
  hours: number;
  valuedCostCents: number | null;
  unvaluedHours: number;
};

export type MonthlyConsumption = {
  month: string;
  chantier: MonthlyConsumptionBucket;
  sav: MonthlyConsumptionBucket;
  generalExpenses: MonthlyConsumptionBucket;
  total: MonthlyConsumptionBucket;
  provisional: boolean;
  estimatedMonthSplit: boolean;
};

/**
 * Recorded hours only, not the full monthly payroll expense.
 * No chantier status filter: closed, archived and cancelled sites retain their consumed labor.
 * A null payroll input means no access to salary-derived costs, not a free hour.
 */
export function calculateMonthlyConsumption(
  mois: string,
  planning: Pick<PlanningPayload, "actualHours" | "indirectHours" | "peopleCapacity">,
  enregistrements: readonly MonthlyLaborCostRecord[] | null,
  maintenant = new Date(),
): MonthlyConsumption {
  financialMonthSchema.parse(mois);
  const horaires = new Map(
    planning.peopleCapacity.map((personne) => [personne.userId, personne.weeklySchedule]),
  );
  const couts = new Map<string, MonthlyLaborCostRecord>();
  for (const enregistrement of enregistrements ?? []) {
    const cle = `${enregistrement.personId}:${enregistrement.month}`;
    if (couts.has(cle)) {
      throw new Error("MONTHLY_LABOR_COST_DUPLICATE");
    }
    couts.set(cle, enregistrement);
  }
  const compartiments = {
    chantier: { hours: 0, cents: 0, unvaluedHours: 0 },
    sav: { hours: 0, cents: 0, unvaluedHours: 0 },
    generalExpenses: { hours: 0, cents: 0, unvaluedHours: 0 },
  };
  const entrees = [
    ...planning.actualHours.map((ligne) => ({
      ...ligne,
      destination: "chantier" as const,
    })),
    ...planning.indirectHours.map((ligne) => ({
      ...ligne,
      destination: ligne.category === "SAV" ? ("sav" as const) : ("generalExpenses" as const),
    })),
  ];
  let provisoire = false;
  let repartitionMoisEstimee = false;
  for (const ligne of entrees) {
    if (ligne.hours <= 0) continue;
    const repartitions = monthlySharesForWeek(ligne.week, horaires.get(ligne.userId));
    const repartition = repartitions.find((element) => element.month === mois);
    if (!repartition) continue;
    repartitionMoisEstimee ||= repartitions.length > 1;
    const compartiment = compartiments[ligne.destination];
    const heures = ligne.hours * repartition.fraction;
    compartiment.hours += heures;
    const coutResolue =
      enregistrements === null
        ? null
        : resolveLaborCostForWorkedMonth(ligne.userId, mois, couts, maintenant);
    if (!coutResolue) {
      compartiment.unvaluedHours += heures;
      continue;
    }
    provisoire ||= coutResolue.provisional;
    compartiment.cents +=
      (heures * coutResolue.record.employerCostCents) / coutResolue.record.workedHours;
  }
  const arrondirHeures = (valeur: number) => Math.round(valeur * 100) / 100;

  function finaliser(compartiment: typeof compartiments.chantier): MonthlyConsumptionBucket {
    const centimes =
      enregistrements !== null && compartiment.unvaluedHours === 0
        ? Math.round(compartiment.cents)
        : null;
    if (centimes !== null && !Number.isSafeInteger(centimes)) {
      throw new Error("MONTHLY_LABOR_COST_INVALID");
    }
    return {
      hours: arrondirHeures(compartiment.hours),
      valuedCostCents: centimes,
      unvaluedHours: arrondirHeures(compartiment.unvaluedHours),
    };
  }

  const chantier = finaliser(compartiments.chantier);
  const sav = finaliser(compartiments.sav);
  const fraisGeneraux = finaliser(compartiments.generalExpenses);
  const totaux = [chantier, sav, fraisGeneraux];
  return {
    month: mois,
    chantier,
    sav,
    generalExpenses: fraisGeneraux,
    total: {
      hours: arrondirHeures(totaux.reduce((somme, compartiment) => somme + compartiment.hours, 0)),
      unvaluedHours: arrondirHeures(
        totaux.reduce((somme, compartiment) => somme + compartiment.unvaluedHours, 0),
      ),
      valuedCostCents: totaux.some((compartiment) => compartiment.valuedCostCents === null)
        ? null
        : totaux.reduce((somme, compartiment) => somme + (compartiment.valuedCostCents ?? 0), 0),
    },
    provisional: provisoire,
    estimatedMonthSplit: repartitionMoisEstimee,
  };
}
