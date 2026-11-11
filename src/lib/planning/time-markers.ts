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
  year: number;
  span: number;
};

export function isoWeekMonday(semaine: string): Date {
  const correspondance = /^(\d{4})-W(\d{2})$/.exec(semaine);
  if (!correspondance) throw new Error(`Invalid ISO week: ${semaine}`);

  const annee = Number(correspondance[1]);
  const numeroSemaine = Number(correspondance[2]);
  const quatreJanvier = new Date(Date.UTC(annee, 0, 4));
  const jourDepuisLundi = (quatreJanvier.getUTCDay() + 6) % 7;
  const premierLundi = new Date(quatreJanvier.getTime() - jourDepuisLundi * DAY_MS);

  return new Date(premierLundi.getTime() + (numeroSemaine - 1) * 7 * DAY_MS);
}

export function isoWeekKey(date: Date): string {
  const dateCalendrier = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const jourIso = dateCalendrier.getUTCDay() || 7;
  dateCalendrier.setUTCDate(dateCalendrier.getUTCDate() + 4 - jourIso);

  const anneeIso = dateCalendrier.getUTCFullYear();
  const debutAnnee = new Date(Date.UTC(anneeIso, 0, 1));
  const numeroSemaine = Math.ceil(
    ((dateCalendrier.getTime() - debutAnnee.getTime()) / DAY_MS + 1) / 7,
  );

  return `${anneeIso}-W${String(numeroSemaine).padStart(2, "0")}`;
}

function shortDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

export function weekDateRangeLabel(semaine: string): string {
  const lundi = isoWeekMonday(semaine);
  const dimanche = new Date(lundi.getTime() + 6 * DAY_MS);
  return `${shortDate(lundi)} au ${shortDate(dimanche)}`;
}

export function buildGrandPlanningWeekMeta(
  semaines: string[],
  maintenant = new Date(),
): GrandPlanningWeekMeta[] {
  const semaineCourante = isoWeekKey(maintenant);
  const lundiCourant = isoWeekMonday(semaineCourante);

  return semaines.map((semaine, indice) => {
    const lundi = isoWeekMonday(semaine);
    const lundiPrecedent = indice > 0 ? isoWeekMonday(semaines[indice - 1]) : null;
    const indiceMois = lundi.getUTCMonth();

    return {
      week: semaine,
      monday: lundi,
      dateRangeLabel: weekDateRangeLabel(semaine),
      monthIndex: indiceMois,
      monthLabel: FRENCH_MONTHS[indiceMois],
      startsMonth: lundiPrecedent == null || lundiPrecedent.getUTCMonth() !== indiceMois,
      isCurrent: semaine === semaineCourante,
      isPast: lundi.getTime() < lundiCourant.getTime(),
    };
  });
}

export function groupGrandPlanningMonths(
  semaines: GrandPlanningWeekMeta[],
): GrandPlanningMonthGroup[] {
  const groupes: GrandPlanningMonthGroup[] = [];

  for (const semaine of semaines) {
    const precedent = groupes.at(-1);
    if (
      precedent &&
      precedent.label === semaine.monthLabel &&
      precedent.year === semaine.monday.getUTCFullYear()
    ) {
      precedent.span += 1;
      continue;
    }

    groupes.push({
      key: `${semaine.week}:${semaine.monthLabel}`,
      label: semaine.monthLabel,
      year: semaine.monday.getUTCFullYear(),
      span: 1,
    });
  }

  return groupes;
}

function planningLocalCalendarDate(maintenant: Date): Date {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(maintenant);
  const valeurs = Object.fromEntries(parties.map((partie) => [partie.type, partie.value]));
  return new Date(Date.UTC(Number(valeurs.year), Number(valeurs.month) - 1, Number(valeurs.day)));
}

export function isPlanningWeekPast(semaine: string, maintenant = new Date()): boolean {
  const datePlanning = planningLocalCalendarDate(maintenant);
  const semaineCourante = isoWeekKey(
    new Date(
      datePlanning.getUTCFullYear(),
      datePlanning.getUTCMonth(),
      datePlanning.getUTCDate(),
    ),
  );
  return isoWeekMonday(semaine).getTime() < isoWeekMonday(semaineCourante).getTime();
}

export function assertPlanningWeekEditable(semaine: string, maintenant = new Date()): void {
  if (isPlanningWeekPast(semaine, maintenant)) throw new Error("PLANNING_PAST_WEEK_LOCKED");
}
