import type { PlanningPayload } from "../planning/domain";
import type { PlanningPersonCapacity } from "../planning/capacity";
import { monthlySharesForWeek } from "./chantier-labor-cost";

/** Holding hours reuse actual BE/atelier/pose, SAV and FG, never the planning forecast. */
export function holdingRecordedHoursForMonth(
  month: string,
  personId: string,
  planning: Pick<PlanningPayload, "actualHours" | "indirectHours">,
  capacities: readonly PlanningPersonCapacity[],
): number {
  const schedule = capacities.find((row) => row.userId === personId)?.weeklySchedule;
  const rows = [
    ...planning.actualHours.filter((r) => r.userId === personId),
    ...planning.indirectHours.filter((r) => r.userId === personId),
  ];
  let hours = 0;
  for (const entry of rows) {
    const part = monthlySharesForWeek(entry.week, schedule).find((s) => s.month === month);
    if (part) hours += entry.hours * part.fraction;
  }
  return Math.round(hours * 100) / 100;
}
