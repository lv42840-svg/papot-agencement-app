import type { PlanningPayload } from "./domain";
export function payrollWeekSignature(
  planning: PlanningPayload,
  personId: string,
  week: string,
): string {
  const direct = planning.actualHours
    .filter((x) => x.userId === personId && x.week === week)
    .map((x) => [x.chantierId, x.activity, x.hours])
    .sort();
  const indirect = planning.indirectHours
    .filter((x) => x.userId === personId && x.week === week)
    .map((x) => [x.category, x.hours])
    .sort();
  const revisions = Object.entries(planning.editRevisions ?? {})
    .filter(([key]) => key.startsWith(`${week}:${personId}:`))
    .sort();
  return JSON.stringify({ direct, indirect, revisions });
}
