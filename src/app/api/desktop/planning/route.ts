import { assertEditRevision } from "@/lib/edit-history";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { readAuthPayload } from "@/lib/auth/store";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { isCommercialActive } from "@/lib/commercial/domain";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { buildWeeklyCapacityIndicators } from "@/lib/planning/capacity";
import { applyPlanningStaffMutation, effectivePlanningPeople } from "@/lib/planning/personnel";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import {
  buildCommercialProvisionRows,
  buildFirmGrandPlanningRows,
  PLANNING_ABSENCE_TYPE_LABELS,
  planningYearWeekIdsRange,
} from "@/lib/planning/domain";
import { assertPlanningWeekEditable, isPlanningWeekPast } from "@/lib/planning/time-markers";
import {
  applyPlanningAbsenceMutation,
  applyPlanningActualHoursMutation,
  applyPlanningChantierOrderMutation,
  applyPlanningDeleteAbsenceMutation,
  applyPlanningDeleteAbsenceBatchMutation,
  applyPlanningFullWeekAbsenceMutation,
  applyPlanningMacroMutation,
  applyPlanningHoursBatchMutation,
  applyPlanningPersonCapacityMutation,
  applyPlanningPotentialOrderMutation,
  applyPlanningProvisionalMutation,
  planningMutationSchema,
} from "@/lib/planning/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const yearSchema = z.coerce.number().int().min(2020).max(2100);

function parseYearRange(startYear: number, valeur: unknown): number {
  const endYear = yearSchema.parse(valeur ?? startYear);
  if (endYear < startYear || endYear - startYear > 2) {
    throw new Error("PLANNING_YEAR_RANGE_INVALID");
  }
  return endYear;
}

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (
    code === "PLANNING_CHANTIER_NOT_ACTIVE" ||
    code === "PLANNING_COMMERCIAL_CASE_NOT_ACTIVE" ||
    code === "PLANNING_USER_NOT_ACTIVE"
  )
    return 409;
  if (code.includes("VERSION_CONFLICT")) return 409;
  if (code.includes("INVALID")) return 400;
  return 400;
}

async function snapshot(
  annee: number,
  endYear: number,
  canWrite: boolean,
  utilisateur: { id: string },
  contexte: Awaited<ReturnType<typeof requireModuleRequestContext>>,
) {
  const [planning, chantiers, commercial, quotes, auth, canEditMacro, canManageSchedules] =
    await Promise.all([
      createPlanningRepository().load(),
      createChantiersRepository(contexte).load(),
      createCommercialRepository().load(),
      createQuotesRepository().load(),
      readAuthPayload(),
      hasEffectiveSpecialPermission(utilisateur, "planning.edit_macro"),
      hasEffectiveSpecialPermission(utilisateur, "planning.manage_schedules"),
    ]);
  const semaines = planningYearWeekIdsRange(annee, endYear);
  const lignesTableau = buildFirmGrandPlanningRows(chantiers, planning, annee, endYear);
  const provisionalRows = buildCommercialProvisionRows(
    commercial,
    planning,
    annee,
    endYear,
    quotes.quotes,
  );
  const firmLoadByWeek = new Map<string, number>();
  const provisionalLoadByWeek = new Map<string, number>();

  for (const ligneTableau of lignesTableau) {
    for (const activity of ligneTableau.activities) {
      for (const [semaine, heures] of Object.entries(activity.weeklyHours)) {
        firmLoadByWeek.set(semaine, (firmLoadByWeek.get(semaine) ?? 0) + heures);
      }
    }
  }

  for (const ligneTableau of provisionalRows) {
    for (const activity of ligneTableau.activities) {
      for (const [semaine, heures] of Object.entries(activity.weeklyHours)) {
        provisionalLoadByWeek.set(semaine, (provisionalLoadByWeek.get(semaine) ?? 0) + heures);
      }
    }
  }

  const peopleCapacity = effectivePlanningPeople(planning, auth.users);
  const personNameById = new Map(
    peopleCapacity.map((personne) => [personne.userId, personne.displayName]),
  );
  const accountNameById = new Map(
    auth.users.map((candidat) => [candidat.id, candidat.displayName]),
  );

  return {
    year: annee,
    endYear,
    weeks: semaines,
    rows: lignesTableau,
    provisionalRows,
    weeklyCapacity: buildWeeklyCapacityIndicators(
      semaines,
      peopleCapacity,
      firmLoadByWeek,
      planning.absences,
      provisionalLoadByWeek,
    ),
    absences: planning.absences
      .filter(
        (absence) =>
          Number(absence.date.slice(0, 4)) >= annee && Number(absence.date.slice(0, 4)) <= endYear,
      )
      .map((absence) => ({
        ...absence,
        displayName:
          personNameById.get(absence.userId) ?? accountNameById.get(absence.userId) ?? "Personnel",
        typeLabel: PLANNING_ABSENCE_TYPE_LABELS[absence.type],
      }))
      .sort((gauche, droite) => gauche.date.localeCompare(droite.date)),
    peopleCapacity,
    availableAccounts:
      canWrite && canManageSchedules
        ? auth.users
            .filter((candidat) => candidat.isActive)
            .map((candidat) => ({ id: candidat.id, displayName: candidat.displayName }))
        : [],
    capabilities: {
      canRead: true,
      canEditMacro: canWrite && canEditMacro,
      canManageSchedules: canWrite && canManageSchedules,
    },
  };
}

export async function GET(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("planning", "READ");
    const url = new URL(requete.url);
    const annee = yearSchema.parse(url.searchParams.get("year") ?? new Date().getFullYear());
    const endYear = parseYearRange(annee, url.searchParams.get("endYear"));
    return noStoreJson(
      await snapshot(annee, endYear, contexte.moduleAccess.canWrite, contexte.user, contexte),
    );
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "PLANNING_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "PLANNING_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(requete: Request) {
  try {
    const corps = await requete.json();
    const annee = yearSchema.parse(corps.year ?? new Date().getFullYear());
    const endYear = parseYearRange(annee, corps.endYear);
    const saisie = planningMutationSchema.parse(corps);
    const contexte = await requireModuleRequestContext("planning", "WRITE");
    const planningRepository = createPlanningRepository();

    if (saisie.action === "setMacroHours") {
      await requireSpecialPermission(contexte.user, "planning.edit_macro");
      assertPlanningWeekEditable(saisie.week);
      const chantiers = await createChantiersRepository(contexte).load();
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      await planningRepository.mutate((contenu) =>
        applyPlanningMacroMutation(contenu, saisie, activeChantierIds),
      );
    } else if (saisie.action === "setHoursBatch") {
      await requireSpecialPermission(contexte.user, "planning.edit_macro");
      for (const update of saisie.updates) {
        assertPlanningWeekEditable(update.week);
        if (!planningYearWeekIdsRange(annee, endYear).includes(update.week)) {
          throw new Error("PLANNING_BATCH_WEEK_INVALID");
        }
      }
      const [chantiers, commercial] = await Promise.all([
        createChantiersRepository(contexte).load(),
        createCommercialRepository().load(),
      ]);
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      const activeCommercialCaseIds = new Set(
        commercial.cases.filter(isCommercialActive).map((element) => element.id),
      );
      await planningRepository.mutate((contenu) =>
        applyPlanningHoursBatchMutation(
          contenu,
          saisie,
          activeChantierIds,
          activeCommercialCaseIds,
        ),
      );
    } else if (saisie.action === "setActualHours") {
      await requireSpecialPermission(contexte.user, "planning.enter_actual_hours");
      if (!isPlanningWeekPast(saisie.week)) throw new Error("PLANNING_ACTUAL_HOURS_WEEK_NOT_PAST");
      const [chantiers, auth] = await Promise.all([
        createChantiersRepository(contexte).load(),
        readAuthPayload(),
      ]);
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      const activeUserIds = new Set(
        auth.users.filter((candidat) => candidat.isActive).map((candidat) => candidat.id),
      );
      await planningRepository.mutate((contenu) => {
        const cle = `${saisie.week}:${saisie.userId}:${saisie.chantierId}`;
        const revision = contenu.editRevisions?.[cle] ?? 0;
        assertEditRevision(corps.expectedRevision, revision);
        const before = contenu.actualHours.filter(
          (ligneTableau) =>
            ligneTableau.week === saisie.week &&
            ligneTableau.userId === saisie.userId &&
            ligneTableau.chantierId === saisie.chantierId,
        );
        const suivant = applyPlanningActualHoursMutation(
          contenu,
          saisie,
          activeChantierIds,
          activeUserIds,
        );
        suivant.editRevisions = { ...contenu.editRevisions, [cle]: revision + 1 };
        suivant.editHistory = [
          ...(contenu.editHistory ?? []),
          {
            key: cle,
            revision: revision + 1,
            at: new Date().toISOString(),
            actorId: contexte.user.id,
            actorName: contexte.user.displayName,
            before,
            after: saisie,
          },
        ];
        return suivant;
      });
    } else if (saisie.action === "setChantierOrder") {
      await requireSpecialPermission(contexte.user, "planning.edit_macro");
      const chantiers = await createChantiersRepository(contexte).load();
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      await planningRepository.mutate((contenu) =>
        applyPlanningChantierOrderMutation(contenu, saisie, activeChantierIds),
      );
    } else if (saisie.action === "setProvisionHours") {
      await requireSpecialPermission(contexte.user, "planning.edit_macro");
      assertPlanningWeekEditable(saisie.week);
      const commercial = await createCommercialRepository().load();
      const activeCommercialCaseIds = new Set(
        commercial.cases.filter(isCommercialActive).map((element) => element.id),
      );
      await planningRepository.mutate((contenu) =>
        applyPlanningProvisionalMutation(contenu, saisie, activeCommercialCaseIds),
      );
    } else if (saisie.action === "setPotentialOrder") {
      await requireSpecialPermission(contexte.user, "planning.edit_macro");
      const commercial = await createCommercialRepository().load();
      const activeCases = commercial.cases.filter(isCommercialActive);
      const activeCaseIds = new Set(activeCases.map((element) => element.id));
      const referenceCaseIds = new Set(
        activeCases
          .filter(
            (element) =>
              element.provisionHours.be > 0 ||
              element.provisionHours.workshop > 0 ||
              element.provisionHours.install > 0,
          )
          .map((element) => element.id),
      );
      await planningRepository.mutate((contenu) => {
        const activePotentialCaseIds = new Set(referenceCaseIds);
        for (const allocation of contenu.provisionalAllocations) {
          if (activeCaseIds.has(allocation.caseId)) activePotentialCaseIds.add(allocation.caseId);
        }
        return applyPlanningPotentialOrderMutation(contenu, saisie, activePotentialCaseIds);
      });
    } else {
      await requireSpecialPermission(contexte.user, "planning.manage_schedules");
      const auth = await readAuthPayload();
      if (
        saisie.action === "saveStaff" ||
        saisie.action === "linkStaffAccount" ||
        saisie.action === "setPersonHidden" ||
        saisie.action === "setStaffEndDate" ||
        saisie.action === "deactivateStaff" ||
        saisie.action === "reactivateStaff" ||
        saisie.action === "deleteStaff"
      ) {
        const activeAccounts = new Set(
          auth.users.filter((candidat) => candidat.isActive).map((candidat) => candidat.id),
        );
        await planningRepository.mutate((contenu) =>
          applyPlanningStaffMutation(contenu, saisie, activeAccounts),
        );
      } else if (saisie.action === "setPersonCapacity") {
        await planningRepository.mutate((contenu) =>
          applyPlanningPersonCapacityMutation(
            contenu,
            saisie,
            new Set(
              effectivePlanningPeople(contenu, auth.users).map((personne) => personne.userId),
            ),
          ),
        );
      } else if (saisie.action === "setAbsence") {
        await planningRepository.mutate((contenu) =>
          applyPlanningAbsenceMutation(
            contenu,
            saisie,
            new Set(
              effectivePlanningPeople(contenu, auth.users).map((personne) => personne.userId),
            ),
          ),
        );
      } else if (saisie.action === "setFullWeekAbsence") {
        await planningRepository.mutate((contenu) =>
          applyPlanningFullWeekAbsenceMutation(
            contenu,
            saisie,
            new Set(
              effectivePlanningPeople(contenu, auth.users).map((personne) => personne.userId),
            ),
          ),
        );
      } else if (saisie.action === "deleteAbsenceBatch") {
        await planningRepository.mutate((contenu) =>
          applyPlanningDeleteAbsenceBatchMutation(contenu, saisie),
        );
      } else {
        await planningRepository.mutate((contenu) =>
          applyPlanningDeleteAbsenceMutation(contenu, saisie),
        );
      }
    }

    return noStoreJson(await snapshot(annee, endYear, true, contexte.user, contexte));
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "PLANNING_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "PLANNING_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}
