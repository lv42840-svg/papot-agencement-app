import type { PlanningPayload } from "../planning/domain";
import type { PlanningPersonCapacity } from "../planning/capacity";
import { monthlySharesForWeek } from "./chantier-labor-cost";

/** Holding hours reuse actual BE/atelier/pose, SAV and FG, never the planning forecast. */
export function holdingRecordedHoursForMonth(
  mois: string,
  idPersonne: string,
  planning: Pick<PlanningPayload, "actualHours" | "indirectHours">,
  capacites: readonly PlanningPersonCapacity[],
): number {
  const horaire = capacites.find((ligne) => ligne.userId === idPersonne)?.weeklySchedule;
  const lignes = [
    ...planning.actualHours.filter((ligne) => ligne.userId === idPersonne),
    ...planning.indirectHours.filter((ligne) => ligne.userId === idPersonne),
  ];
  let heures = 0;
  for (const entree of lignes) {
    const part = monthlySharesForWeek(entree.week, horaire).find(
      (repartition) => repartition.month === mois,
    );
    if (part) heures += entree.hours * part.fraction;
  }
  return Math.round(heures * 100) / 100;
}
