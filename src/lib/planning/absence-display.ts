import {
  isoWeekDates,
  scheduleHoursForDate,
  DEFAULT_WEEKLY_SCHEDULE,
  type PlanningPersonCapacity,
} from "./capacity";
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
  const [annee, mois, jour] = date.split("-").map(Number);
  return isoWeekKey(new Date(annee, mois - 1, jour, 12));
}

function groupedEntry(
  lignes: DisplayAbsence[],
  semaine: string,
  cle: string,
): AbsenceDisplayEntry {
  const lignesTriees = [...lignes].sort((gauche, droite) =>
    gauche.date.localeCompare(droite.date),
  );
  const premiere = lignesTriees[0];
  return {
    key: cle,
    kind: "week",
    userId: premiere.userId,
    displayName: premiere.displayName,
    type: premiere.type,
    typeLabel: premiere.typeLabel,
    week: semaine,
    startDate: lignesTriees[0].date,
    endDate: lignesTriees[lignesTriees.length - 1].date,
    hours: lignesTriees.reduce((somme, ligne) => somme + ligne.hours, 0),
    absenceIds: lignesTriees.map((ligne) => ligne.id),
    days: lignesTriees.length,
  };
}

export function groupPlanningAbsences(
  absences: readonly DisplayAbsence[],
  personnes: readonly Pick<PlanningPersonCapacity, "userId" | "weeklySchedule">[],
): AbsenceDisplayEntry[] {
  const horaires = new Map(
    personnes.map((personne) => [personne.userId, personne.weeklySchedule]),
  );
  const identifiantsUtilises = new Set<string>();
  const resultats: AbsenceDisplayEntry[] = [];

  // Newly recorded complete weeks have a stable group ID, even when shifts later change.
  const groupesPersistes = new Map<string, DisplayAbsence[]>();
  for (const absence of absences) {
    if (!absence.weekGroupId) continue;
    const lignes = groupesPersistes.get(absence.weekGroupId) ?? [];
    lignes.push(absence);
    groupesPersistes.set(absence.weekGroupId, lignes);
  }
  for (const [idGroupe, lignes] of groupesPersistes) {
    const premiere = lignes[0];
    const semaine = weekFor(premiere.date);
    if (
      lignes.some(
        (ligne) =>
          ligne.userId !== premiere.userId ||
          ligne.type !== premiere.type ||
          weekFor(ligne.date) !== semaine,
      )
    ) {
      continue;
    }
    resultats.push(groupedEntry(lignes, semaine, "week:" + idGroupe));
    lignes.forEach((ligne) => identifiantsUtilises.add(ligne.id));
  }

  // Old complete weeks were stored as one row per day. Recognize only an exact
  // match to working dates/hours, never merge unrelated partial absences.
  const groupesHistoriques = new Map<string, DisplayAbsence[]>();
  for (const absence of absences) {
    if (identifiantsUtilises.has(absence.id)) continue;
    const semaine = weekFor(absence.date);
    const cle = [absence.userId, semaine, absence.type].join(":");
    const lignes = groupesHistoriques.get(cle) ?? [];
    lignes.push(absence);
    groupesHistoriques.set(cle, lignes);
  }
  for (const [cle, lignes] of groupesHistoriques) {
    const premiere = lignes[0];
    const semaine = weekFor(premiere.date);
    const horaire = horaires.get(premiere.userId) ?? DEFAULT_WEEKLY_SCHEDULE;
    const joursAttendus = isoWeekDates(semaine)
      .map((date) => ({
        date: date.toISOString().slice(0, 10),
        hours: scheduleHoursForDate(horaire, date),
      }))
      .filter((jour) => jour.hours > 0);
    if (
      joursAttendus.length < 2 ||
      joursAttendus.length !== lignes.length ||
      !joursAttendus.every((jour) =>
        lignes.some(
          (ligne) =>
            ligne.date === jour.date && Math.abs(ligne.hours - jour.hours) < 0.000001,
        ),
      )
    ) {
      continue;
    }
    resultats.push(groupedEntry(lignes, semaine, "legacy-week:" + cle));
    lignes.forEach((ligne) => identifiantsUtilises.add(ligne.id));
  }

  for (const absence of absences) {
    if (identifiantsUtilises.has(absence.id)) continue;
    resultats.push({
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
  return resultats.sort(
    (gauche, droite) =>
      droite.startDate.localeCompare(gauche.startDate) || gauche.key.localeCompare(droite.key),
  );
}
