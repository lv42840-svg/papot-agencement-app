import { isoWeekKey, isoWeekMonday } from "./time-markers";

/** Match the company's Paris calendar even when the server runs in UTC. */
export function currentDashboardPlanningWeek(maintenant = new Date()): string {
  const parties = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(maintenant);
  const valeurs = Object.fromEntries(parties.map((partie) => [partie.type, partie.value]));
  return isoWeekKey(
    new Date(Number(valeurs.year), Number(valeurs.month) - 1, Number(valeurs.day), 12),
  );
}

/** Use an ISO week Monday to cross month and year boundaries correctly. */
export function shiftDashboardPlanningWeek(semaine: string, decalage: number): string {
  const lundi = isoWeekMonday(semaine);
  lundi.setUTCDate(lundi.getUTCDate() + decalage * 7);
  return isoWeekKey(new Date(lundi.getUTCFullYear(), lundi.getUTCMonth(), lundi.getUTCDate(), 12));
}
