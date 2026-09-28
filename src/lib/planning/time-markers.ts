const DAY_MS = 24 * 60 * 60 * 1000;

export const FRENCH_MONTHS = [
  "JANVIER",
  "FÉVRIER",
  "MARS",
  "AVRIL",
  "MAI",
  "JUIN",
  "JUILLET",
  "AOÛT",
  "SEPTEMBRE",
  "OCTOBRE",
  "NOVEMBRE",
  "DÉCEMBRE",
] as const;

export type GrandPlanningWeekMeta = {
  week: string;
  monday: Date;
  dateRangeLabel: string;
  monthIndex: number;
  monthLabel: string;
  startsMonth: boolean;
  isCurrent: boolean;
  isPast: boolean;
};

export type GrandPlanningMonthGroup = {
  key: string;
  label: string;
  span: number;
};

export function isoWeekMonday(week: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new Error(`Invalid ISO week: ${week}`);

  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const dayFromMonday = (januaryFourth.getUTCDay() + 6) % 7;
  const firstMonday = new Date(januaryFourth.getTime() - dayFromMonday * DAY_MS);

  return new Date(firstMonday.getTime() + (weekNumber - 1) * 7 * DAY_MS);
}

export function isoWeekKey(date: Date): string {
  const calendarDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const isoDay = calendarDate.getUTCDay() || 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() + 4 - isoDay);

  const isoYear = calendarDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(((calendarDate.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);

  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

function shortDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

export function weekDateRangeLabel(week: string): string {
  const monday = isoWeekMonday(week);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return `${shortDate(monday)} au ${shortDate(sunday)}`;
}

export function buildGrandPlanningWeekMeta(
  weeks: string[],
  now = new Date(),
): GrandPlanningWeekMeta[] {
  const currentWeek = isoWeekKey(now);
  const currentMonday = isoWeekMonday(currentWeek);

  return weeks.map((week, index) => {
    const monday = isoWeekMonday(week);
    const previousMonday = index > 0 ? isoWeekMonday(weeks[index - 1]) : null;
    const monthIndex = monday.getUTCMonth();

    return {
      week,
      monday,
      dateRangeLabel: weekDateRangeLabel(week),
      monthIndex,
      monthLabel: FRENCH_MONTHS[monthIndex],
      startsMonth: previousMonday == null || previousMonday.getUTCMonth() !== monthIndex,
      isCurrent: week === currentWeek,
      isPast: monday.getTime() < currentMonday.getTime(),
    };
  });
}

export function groupGrandPlanningMonths(
  weeks: GrandPlanningWeekMeta[],
): GrandPlanningMonthGroup[] {
  const groups: GrandPlanningMonthGroup[] = [];

  for (const week of weeks) {
    const previous = groups.at(-1);
    if (previous && previous.label === week.monthLabel) {
      previous.span += 1;
      continue;
    }

    groups.push({
      key: `${week.week}:${week.monthLabel}`,
      label: week.monthLabel,
      span: 1,
    });
  }

  return groups;
}
