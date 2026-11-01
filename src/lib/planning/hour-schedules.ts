import { DEFAULT_WEEKLY_SCHEDULE } from "./capacity";
import type { PlanningPayload } from "./domain";
/** Legacy rows can only retain today's known schedule; no historical schedule is invented. */
export function freezeHourSchedules(
  payload: PlanningPayload,
  previous?: PlanningPayload,
): PlanningPayload {
  const schedules = new Map(
    payload.peopleCapacity.map((person) => [person.userId, person.weeklySchedule]),
  );
  const key = (row: {
    userId: string;
    week: string;
    chantierId?: string;
    activity?: string;
    category?: string;
  }) => JSON.stringify([row.userId, row.week, row.chantierId, row.activity, row.category]);
  const old = new Map(
    [...(previous?.actualHours ?? []), ...(previous?.indirectHours ?? [])].map((row) => [
      key(row),
      row.scheduleAtEntry,
    ]),
  );
  const freeze = <
    T extends PlanningPayload["actualHours"][number] | PlanningPayload["indirectHours"][number],
  >(
    row: T,
  ): T => ({
    ...row,
    scheduleAtEntry: structuredClone(
      old.get(key(row)) ??
        row.scheduleAtEntry ??
        schedules.get(row.userId) ??
        DEFAULT_WEEKLY_SCHEDULE,
    ),
  });
  return {
    ...payload,
    actualHours: payload.actualHours.map(freeze),
    indirectHours: payload.indirectHours.map(freeze),
  };
}
export function hasUnfrozenHours(payload: PlanningPayload) {
  return [...payload.actualHours, ...payload.indirectHours].some((row) => !row.scheduleAtEntry);
}
