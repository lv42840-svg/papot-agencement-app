import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { readAuthPayload } from "@/lib/auth/store";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { effectivePlanningPeople, personPresentOnDate } from "@/lib/planning/personnel";
import {
  buildWeeklyCapacityIndicators,
  frenchNationalPublicHolidayLabels,
  scheduleHoursForDate,
} from "@/lib/planning/capacity";
import {
  buildFirmGrandPlanningRows,
  buildCommercialProvisionRows,
  PLANNING_ABSENCE_TYPE_LABELS,
} from "@/lib/planning/domain";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  weeklyBoardAssignmentSchema,
  weeklyBoardEntrySchema,
  weeklyBoardPasteSchema,
  applyWeeklyBoardEntry,
  applyWeeklyBoardPaste,
  weeklyChantierHours,
  weeklyBoardWeekSchema,
  workingDaysOfWeek,
  applyDailyAssignment,
  weekActivityHours,
} from "@/lib/planning/weekly-board";
import { assertPlanningWeekEditable, isPlanningWeekPast } from "@/lib/planning/time-markers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(valeur: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(valeur, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function sendError(erreur: unknown) {
  const code =
    erreur instanceof ZodError
      ? "PLANNING_WEEK_REQUEST_INVALID"
      : erreur instanceof Error
        ? erreur.message
        : "PLANNING_WEEK_FAILED";
  const statut =
    desktopRequestErrorStatus(code) ??
    (code.includes("NOT_ACTIVE") || code.includes("CONFLICT") ? 409 : 400);
  return noStoreJson({ error: code }, { status: statut });
}

async function weeklySnapshot(
  semaine: string,
  contexte: Awaited<ReturnType<typeof requireModuleRequestContext>>,
) {
  const [planning, chantiers, commercial, quotes, auth, canManage] = await Promise.all([
    createPlanningRepository().load(),
    createChantiersRepository(contexte).load(),
    createCommercialRepository().load(),
    createQuotesRepository().load(),
    readAuthPayload(),
    hasEffectiveSpecialPermission(contexte.user, "planning.manage_schedules"),
  ]);
  const annee = Number(semaine.slice(0, 4));
  const firmRows = buildFirmGrandPlanningRows(chantiers, planning, annee);
  const potentialRows = buildCommercialProvisionRows(
    commercial,
    planning,
    annee,
    annee,
    quotes.quotes,
  );
  // The small board must display the exact totals used in the grand planning.
  const firm = weekActivityHours(firmRows, semaine);
  const firmChantiers = weeklyChantierHours(firmRows, semaine, "firm", (indice) => ({
    id: firmRows[indice].chantierId,
    name: firmRows[indice].name,
  }));
  const provisional = weekActivityHours(potentialRows, semaine);
  const provisionalChantiers = weeklyChantierHours(
    potentialRows,
    semaine,
    "provisional",
    (indice) => ({
      id: potentialRows[indice].caseId,
      name: potentialRows[indice].name,
    }),
  );
  const allPeople = effectivePlanningPeople(planning, auth.users);
  const dates = workingDaysOfWeek(semaine);
  const personnes = allPeople.filter(
    (personne) =>
      !personne.hiddenInWeeklyBoard &&
      (dates.some((date) => personPresentOnDate(personne, date)) ||
        planning.dailyAssignments.some(
          (ligneTableau) =>
            ligneTableau.userId === personne.userId && dates.includes(ligneTableau.date),
        ) ||
        planning.absences.some(
          (ligneTableau) =>
            ligneTableau.userId === personne.userId && dates.includes(ligneTableau.date),
        )),
  );
  const holidays = dates.map((date) => ({
    date,
    label: frenchNationalPublicHolidayLabels(Number(date.slice(0, 4))).get(date) ?? null,
  }));
  const allSiteNames = new Map(chantiers.chantiers.map((site) => [site.id, site.name]));
  const assignments = planning.dailyAssignments
    .filter(
      (ligneTableau) =>
        dates.includes(ligneTableau.date) &&
        personnes.some((personne) => personne.userId === ligneTableau.userId),
    )
    .map((ligneTableau) => ({
      ...ligneTableau,
      label: ligneTableau.chantierId
        ? (allSiteNames.get(ligneTableau.chantierId) ?? ligneTableau.label)
        : ligneTableau.label,
    }));
  const absences = planning.absences
    .filter((ligneTableau) => dates.includes(ligneTableau.date))
    .map((ligneTableau) => ({
      ...ligneTableau,
      typeLabel: PLANNING_ABSENCE_TYPE_LABELS[ligneTableau.type],
    }));
  const capacity = buildWeeklyCapacityIndicators(
    [semaine],
    allPeople,
    new Map([[semaine, firm.total]]),
    planning.absences,
    new Map([[semaine, provisional.total]]),
  )[0];
  return {
    week: semaine,
    dates,
    people: personnes.map((personne) => ({
      userId: personne.userId,
      displayName: personne.displayName,
      countsInMacroCapacity: personne.countsInMacroCapacity,
      weeklySchedule: personne.weeklySchedule,
      endDate: personne.endDate,
      inactiveSince: personne.inactiveSince,
    })),
    sites: chantiers.chantiers
      .filter((site) => site.status === "ACTIVE")
      .map((site) => ({ id: site.id, name: site.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    assignments,
    absences,
    holidays,
    firmChantiers,
    provisionalChantiers,
    firm,
    provisional,
    capacity,
    editable: contexte.moduleAccess.canWrite && canManage && !isPlanningWeekPast(semaine),
  };
}

export async function GET(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("planning", "READ");
    const semaine = weeklyBoardWeekSchema.parse(new URL(requete.url).searchParams.get("week"));
    return noStoreJson(await weeklySnapshot(semaine, contexte));
  } catch (erreur) {
    return sendError(erreur);
  }
}

export async function POST(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("planning", "WRITE");
    await requireSpecialPermission(contexte.user, "planning.manage_schedules");
    const saisie = z
      .union([weeklyBoardAssignmentSchema, weeklyBoardEntrySchema, weeklyBoardPasteSchema])
      .parse(await requete.json());
    assertPlanningWeekEditable(saisie.week);
    const [auth, chantiers] = await Promise.all([
      readAuthPayload(),
      createChantiersRepository(contexte).load(),
    ]);
    const activeSites = chantiers.chantiers
      .filter((site) => site.status === "ACTIVE")
      .map((site) => ({ id: site.id, name: site.name }));
    await createPlanningRepository().mutate((contenu) => {
      const personnes = effectivePlanningPeople(contenu, auth.users);
      const selectedPerson = personnes.find((personne) => personne.userId === saisie.userId);
      if (!selectedPerson) throw new Error("PLANNING_USER_NOT_ACTIVE");
      if (saisie.action !== "deleteDailyEntry" && !personPresentOnDate(selectedPerson, saisie.date))
        throw new Error("PLANNING_PERSON_NOT_PRESENT");
      if (saisie.action === "pasteDailyEntries") {
        const scheduled = scheduleHoursForDate(
          selectedPerson.weeklySchedule,
          new Date(saisie.date + "T12:00:00Z"),
        );
        const absence = contenu.absences.find(
          (ligneTableau) =>
            ligneTableau.userId === saisie.userId && ligneTableau.date === saisie.date,
        );
        if (absence && scheduled > 0 && absence.hours >= scheduled) {
          throw new Error("PLANNING_DAY_PERSON_ABSENT");
        }
        return applyWeeklyBoardPaste(
          contenu,
          saisie,
          new Set(personnes.map((personne) => personne.userId)),
          activeSites,
        );
      }
      if (saisie.action !== "setDailyAssignment") {
        // The full-day absence rule is enforced server-side, not only by hiding the UI.
        const personne = personnes.find((personne) => personne.userId === saisie.userId);
        const absence = contenu.absences.find(
          (ligneTableau) =>
            ligneTableau.userId === saisie.userId && ligneTableau.date === saisie.date,
        );
        if (
          saisie.action === "saveDailyEntry" &&
          personne &&
          absence &&
          absence.hours >=
            scheduleHoursForDate(personne.weeklySchedule, new Date(saisie.date + "T12:00:00Z")) &&
          scheduleHoursForDate(personne.weeklySchedule, new Date(saisie.date + "T12:00:00Z")) > 0
        )
          throw new Error("PLANNING_DAY_PERSON_ABSENT");
        return applyWeeklyBoardEntry(
          contenu,
          saisie,
          new Set(personnes.map((personne) => personne.userId)),
          activeSites,
        );
      }
      return applyDailyAssignment(
        contenu,
        saisie,
        new Set(personnes.map((personne) => personne.userId)),
        activeSites,
      );
    });
    return noStoreJson(await weeklySnapshot(saisie.week, contexte));
  } catch (erreur) {
    return sendError(erreur);
  }
}
