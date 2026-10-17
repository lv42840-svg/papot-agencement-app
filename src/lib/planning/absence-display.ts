import { isoWeekDates, scheduleHoursForDate, DEFAULT_WEEKLY_SCHEDULE, type PlanningPersonCapacity } from "./capacity";
import type { PlanningAbsence } from "./domain";
import { isoWeekKey } from "./time-markers";

export type DisplayAbsence = PlanningAbsence & {
  displayName: string;
  typeLabel: string;
};

export type AbsenceDisplayEntry = {
  key: string;
  kind: "day" | "week";
  userId: string;
  displayName: string;
  type: PlanningAbsence["type"];
  typeLabel: string;
  week: string;
  startDate: string;
  endDate: string;
  hours: number;
  absenceIds: string[];
  days: number;
};

function weekFor(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return isoWeekKey(new Date(year, month - 1, day, 12));
}

function groupedEntry(rows: DisplayAbsence[], week: string, key: string): AbsenceDisplayEntry {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  return {
    key,
    kind: "week",
    userId: first.userId,
    displayName: first.displayName,
    type: first.type,
    typeLabel: first.typeLabel,
    week,
    startDate: sorted[0].date,
    endDate: sorted[sorted.length - 1].date,
    hours: sorted.reduce((sum, row) => sum + row.hours, 0),
    absenceIds: sorted.map((row) => row.id),
    days: sorted.length,
  };
}

export function groupPlanningAbsences(
  absences: readonly DisplayAbsence[],
  people: readonly Pick<PlanningPersonCapacity, "userId" | "weeklySchedule">[],
): AbsenceDisplayEntry[] {
  const schedules = new Map(people.map((person) => [person.userId, person.weeklySchedule]));
  const usedIds = new Set<string>();
  const results: AbsenceDisplayEntry[] = [];

  // Newly recorded complete weeks have a stable group ID, even when shifts later change.
  const persistedGroups = new Map<string, DisplayAbsence[]>();
  for (const absence of absences) {
    if (!absence.weekGroupId) continue;
    const rows = persistedGroups.get(absence.weekGroupId) ?? [];
    rows.push(absence);
    persistedGroups.set(absence.weekGroupId, rows);
  }
  for (const [groupId, rows] of persistedGroups) {
    const first = rows[0];
    const week = weekFor(first.date);
    if (
      rows.some((row) =>
        row.userId !== first.userId || row.type !== first.type || weekFor(row.date) !== week
      )
    ) continue;
    results.push(groupedEntry(rows, week, "week:" + groupId));
    rows.forEach((row) => usedIds.add(row.id));
  }

  // Old complete weeks were stored as one row per day. Recognize only an exact
  // match to working dates/hours, never merge unrelated partial absences.
  const legacy = new Map<string, DisplayAbsence[]>();
  for (const absence of absences) {
    if (usedIds.has(absence.id)) continue;
    const week = weekFor(absence.date);
    const key = [absence.userId, week, absence.type].join(":");
    const rows = legacy.get(key) ?? [];
    rows.push(absence);
    legacy.set(key, rows);
  }
  for (const [key, rows] of legacy) {
    const first = rows[0];
    const week = weekFor(first.date);
    const schedule = schedules.get(first.userId) ?? DEFAULT_WEEKLY_SCHEDULE;
    const expected = isoWeekDates(week)
      .map((date) => ({
        date: date.toISOString().slice(0, 10),
        hours: scheduleHoursForDate(schedule, date),
      }))
      .filter((day) => day.hours > 0);
    if (
      expected.length < 2 ||
      expected.length !== rows.length ||
      !expected.every((day) =>
        rows.some((row) => row.date === day.date && Math.abs(row.hours - day.hours) < 0.000001)
      )
    ) continue;
    results.push(groupedEntry(rows, week, "legacy-week:" + key));
    rows.forEach((row) => usedIds.add(row.id));
  }

  for (const absence of absences) {
    if (usedIds.has(absence.id)) continue;
    results.push({
      key: "day:" + absence.id,
      kind: "day",
      userId: absence.userId,
      displayName: absence.displayName,
      type: absence.type,
      typeLabel: absence.typeLabel,
      week: weekFor(absence.date),
      startDate: absence.date,
      endDate: absence.date,
      hours: absence.hours,
      absenceIds: [absence.id],
      days: 1,
    });
  }
  return results.sort(
    (a, b) => b.startDate.localeCompare(a.startDate) || a.key.localeCompare(b.key),
  );
}
