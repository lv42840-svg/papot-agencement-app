import { z } from "zod";
import type { PlanningAbsence } from "./domain";

const weekdayHoursSchema = z.object({
  monday: z.number().finite().nonnegative().max(24),
  tuesday: z.number().finite().nonnegative().max(24),
  wednesday: z.number().finite().nonnegative().max(24),
  thursday: z.number().finite().nonnegative().max(24),
  friday: z.number().finite().nonnegative().max(24),
  saturday: z.number().finite().nonnegative().max(24),
  sunday: z.number().finite().nonnegative().max(24),
});

export const planningPersonCapacitySchema = z.object({
  userId: z.string().uuid(),
  countsInMacroCapacity: z.boolean(),
  weeklySchedule: weekdayHoursSchema,
});

export type PlanningPersonCapacity = z.infer<typeof planningPersonCapacitySchema>;
export type PlanningWeekCapacity = {
  week: string;
  totalCapacityHours: number;
  firmLoadHours: number;
  provisionalLoadHours: number;
  firmAvailableHours: number;
  availableWithProvisionHours: number;
};

export const DEFAULT_WEEKLY_SCHEDULE = {
  monday: 7.8,
  tuesday: 7.8,
  wednesday: 7.8,
  thursday: 7.8,
  friday: 7.8,
  saturday: 0,
  sunday: 0,
} satisfies z.infer<typeof weekdayHoursSchema>;

// Applied only when a new independent personnel record is created.
// Existing staff schedules and legacy login accounts keep their current hours.
export const NEW_STAFF_WEEKLY_SCHEDULE = {
  monday: 8.5,
  tuesday: 8.5,
  wednesday: 8.5,
  thursday: 8.5,
  friday: 4.5,
  saturday: 0,
  sunday: 0,
} satisfies z.infer<typeof weekdayHoursSchema>;

export function weeklyScheduleHours(horaire: PlanningPersonCapacity["weeklySchedule"]): number {
  return Object.values(horaire).reduce((somme, heures) => somme + heures, 0);
}

type WeekdayKey = keyof PlanningPersonCapacity["weeklySchedule"];

const WEEKDAY_KEYS: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function easterSunday(annee: number): Date {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(annee, mois - 1, jour));
}

function addUtcDays(date: Date, jours: number): Date {
  const nouvelleDate = new Date(date);
  nouvelleDate.setUTCDate(nouvelleDate.getUTCDate() + jours);
  return nouvelleDate;
}

function dateId(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function frenchNationalPublicHolidayIds(annee: number): Set<string> {
  const paques = easterSunday(annee);
  const joursFixes = [
    [1, 1],
    [5, 1],
    [5, 8],
    [7, 14],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
  ] as const;
  const identifiants = new Set(
    joursFixes.map(([mois, jour]) => dateId(new Date(Date.UTC(annee, mois - 1, jour)))),
  );
  identifiants.add(dateId(addUtcDays(paques, 1)));
  identifiants.add(dateId(addUtcDays(paques, 39)));
  identifiants.add(dateId(addUtcDays(paques, 50)));
  return identifiants;
}

// Labels share the existing holiday calendar used by capacity calculations.
export function frenchNationalPublicHolidayLabels(annee: number): Map<string, string> {
  const paques = easterSunday(annee);
  const joursFixes: Array<[number, number, string]> = [
    [1, 1, "Jour de l'An"],
    [5, 1, "Fête du Travail"],
    [5, 8, "Victoire du 8 mai"],
    [7, 14, "Fête nationale"],
    [8, 15, "Assomption"],
    [11, 1, "Toussaint"],
    [11, 11, "Armistice"],
    [12, 25, "Noël"],
  ];
  const joursFeries = new Map<string, string>(
    joursFixes.map(([mois, jour, libelle]) => [
      dateId(new Date(Date.UTC(annee, mois - 1, jour))),
      libelle,
    ]),
  );
  joursFeries.set(dateId(addUtcDays(paques, 1)), "Lundi de Pâques");
  joursFeries.set(dateId(addUtcDays(paques, 39)), "Ascension");
  joursFeries.set(dateId(addUtcDays(paques, 50)), "Lundi de Pentecôte");
  return joursFeries;
}

export function isoWeekDates(idSemaine: string): Date[] {
  const correspondance = /^(\d{4})-W(\d{2})$/.exec(idSemaine);
  if (!correspondance) throw new Error("PLANNING_WEEK_INVALID");
  const annee = Number(correspondance[1]);
  const semaine = Number(correspondance[2]);
  const quatreJanvier = new Date(Date.UTC(annee, 0, 4));
  const jourQuatreJanvier = quatreJanvier.getUTCDay() || 7;
  const lundi = new Date(quatreJanvier);
  lundi.setUTCDate(quatreJanvier.getUTCDate() - jourQuatreJanvier + 1 + (semaine - 1) * 7);
  return Array.from({ length: 7 }, (_, indice) => addUtcDays(lundi, indice));
}

export function scheduleHoursForDate(
  horaire: PlanningPersonCapacity["weeklySchedule"],
  date: Date,
): number {
  const joursFeries = frenchNationalPublicHolidayIds(date.getUTCFullYear());
  if (joursFeries.has(dateId(date))) return 0;
  const jour = date.getUTCDay();
  const indice = jour === 0 ? 6 : jour - 1;
  return horaire[WEEKDAY_KEYS[indice]];
}

// Used to propose absence hours; the user may still enter a partial day.
// National public holidays already contribute zero capacity.
export function suggestedAbsenceHoursForDate(
  horaire: PlanningPersonCapacity["weeklySchedule"],
  identifiantDate: string,
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(identifiantDate)) return 0;
  const jour = new Date(`${identifiantDate}T12:00:00Z`);
  if (Number.isNaN(jour.getTime()) || jour.toISOString().slice(0, 10) !== identifiantDate) {
    return 0;
  }
  return scheduleHoursForDate(horaire, jour);
}

export function weeklyScheduleHoursForWeek(
  horaire: PlanningPersonCapacity["weeklySchedule"],
  idSemaine: string,
): number {
  const dates = isoWeekDates(idSemaine);
  return dates.reduce((somme, date) => somme + scheduleHoursForDate(horaire, date), 0);
}

export function buildWeeklyCapacityIndicators(
  semaines: string[],
  personnes: (PlanningPersonCapacity & {
    endDate?: string | null;
    inactiveSince?: string | null;
  })[],
  chargeFermeParSemaine: ReadonlyMap<string, number>,
  absences: PlanningAbsence[] = [],
  chargeProvisionnelleParSemaine: ReadonlyMap<string, number> = new Map(),
): PlanningWeekCapacity[] {
  const personnesComptabilisees = personnes.filter((personne) => personne.countsInMacroCapacity);

  return semaines.map((semaine) => {
    const dates = isoWeekDates(semaine);
    const capaciteTotaleHeures = personnesComptabilisees.reduce((somme, personne) => {
      const absencesParDate = new Map(
        absences
          .filter((absence) => absence.userId === personne.userId)
          .map((absence) => [absence.date, absence]),
      );
      return (
        somme +
        dates.reduce((capacitePersonneSemaine, date) => {
          const identifiantDate = dateId(date);
          if (
            (personne.endDate && identifiantDate > personne.endDate) ||
            (personne.inactiveSince && identifiantDate >= personne.inactiveSince)
          ) {
            return capacitePersonneSemaine;
          }
          const heuresPrevues = scheduleHoursForDate(personne.weeklySchedule, date);
          const absence = absencesParDate.get(dateId(date));
          const heuresIndisponibles = absence ? Math.min(absence.hours, heuresPrevues) : 0;
          return capacitePersonneSemaine + Math.max(0, heuresPrevues - heuresIndisponibles);
        }, 0)
      );
    }, 0);
    const chargeFermeHeures = chargeFermeParSemaine.get(semaine) ?? 0;
    const chargeProvisionnelleHeures = chargeProvisionnelleParSemaine.get(semaine) ?? 0;
    return {
      week: semaine,
      totalCapacityHours: capaciteTotaleHeures,
      firmLoadHours: chargeFermeHeures,
      provisionalLoadHours: chargeProvisionnelleHeures,
      firmAvailableHours: capaciteTotaleHeures - chargeFermeHeures,
      availableWithProvisionHours:
        capaciteTotaleHeures - chargeFermeHeures - chargeProvisionnelleHeures,
    };
  });
}
