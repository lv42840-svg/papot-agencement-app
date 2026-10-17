import { isoWeekKey, isoWeekMonday } from "./time-markers";

/** Match the company's Paris calendar even when the server runs in UTC. */
export function currentDashboardPlanningWeek(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return isoWeekKey(new Date(Number(values.year), Number(values.month) - 1, Number(values.day), 12));
}

/** Use an ISO week Monday to cross month and year boundaries correctly. */
export function shiftDashboardPlanningWeek(week: string, offset: number): string {
  const monday = isoWeekMonday(week);
  monday.setUTCDate(monday.getUTCDate() + offset * 7);
  return isoWeekKey(
    new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 12),
  );
}
