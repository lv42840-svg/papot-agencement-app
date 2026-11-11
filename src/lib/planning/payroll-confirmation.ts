import type { PlanningPayload } from "./domain";
export function payrollWeekSignature(
  planning: PlanningPayload,
  idPersonne: string,
  semaine: string,
): string {
  const heuresDirectes = planning.actualHours
    .filter((ligne) => ligne.userId === idPersonne && ligne.week === semaine)
    .map((ligne) => [ligne.chantierId, ligne.activity, ligne.hours])
    .sort();
  const heuresIndirectes = planning.indirectHours
    .filter((ligne) => ligne.userId === idPersonne && ligne.week === semaine)
    .map((ligne) => [ligne.category, ligne.hours])
    .sort();
  const revisions = Object.entries(planning.editRevisions ?? {})
    .filter(([cle]) => cle.startsWith(`${semaine}:${idPersonne}:`))
    .sort();
  return JSON.stringify({
    direct: heuresDirectes,
    indirect: heuresIndirectes,
    revisions,
  });
}
