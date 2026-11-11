import { payrollWeekSignature } from "@/lib/planning/payroll-confirmation";
import { assertEditRevision } from "@/lib/edit-history";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireSpecialPermission, hasEffectiveSpecialPermission } from "@/lib/auth/permissions";
import { readAuthPayload } from "@/lib/auth/store";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import {
  actualHoursByActivity,
  actualHoursRowSchema,
  actualHoursWeekSchema,
  applyActualHoursRow,
  applyIndirectHoursRow,
  indirectHoursRowSchema,
} from "@/lib/planning/actual-hours";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { scheduledChantiersByPerson } from "@/lib/planning/actual-hours-suggestions";
import { effectivePlanningPeople } from "@/lib/planning/personnel";
import { isPlanningWeekPast } from "@/lib/planning/time-markers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(contenu: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(contenu, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function statusFor(code: string) {
  return (
    desktopRequestErrorStatus(code) ??
    (code.includes("FORBIDDEN")
      ? 403
      : code.includes("NOT_FOUND")
        ? 404
        : code.includes("NOT_PAST") || code.includes("TOO_HIGH") || code.includes("CONFLICT")
          ? 409
          : 400)
  );
}

function reportError(erreur: unknown) {
  const code =
    erreur instanceof ZodError
      ? "PLANNING_ACTUAL_HOURS_INVALID"
      : erreur instanceof Error
        ? erreur.message
        : "PLANNING_ACTUAL_HOURS_FAILED";
  return noStoreJson({ error: code }, { status: statusFor(code) });
}

async function snapshot(
  semaine: string,
  contexte: Awaited<ReturnType<typeof requireModuleRequestContext>>,
) {
  const [planning, chantiers, auth, canEnter] = await Promise.all([
    createPlanningRepository().load(),
    createChantiersRepository(contexte).load(),
    readAuthPayload(),
    hasEffectiveSpecialPermission(contexte.user, "planning.enter_actual_hours"),
  ]);

  const personnes = effectivePlanningPeople(planning, auth.users);
  const parId = new Map(personnes.map((personne) => [personne.userId, personne.displayName]));
  // Existing hours must remain readable after a legacy account is deactivated.
  for (const account of auth.users) {
    if (!parId.has(account.id)) parId.set(account.id, account.displayName);
  }
  const storedPeople = new Set([
    ...planning.actualHours.map((entree) => entree.userId),
    ...planning.indirectHours.map((entree) => entree.userId),
  ]);
  const personnel = [
    ...personnes.map((personne) => ({
      id: personne.userId,
      name: personne.displayName,
      endDate: personne.endDate,
      inactiveSince: personne.inactiveSince,
    })),
    ...auth.users
      .filter(
        (personne) =>
          storedPeople.has(personne.id) &&
          !personnes.some((active) => active.userId === personne.id),
      )
      .map((personne) => ({
        id: personne.id,
        name: personne.displayName,
        endDate: null,
        inactiveSince: null,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const recorded = planning.actualHours.filter((entree) => entree.week === semaine);
  const chantierRows = chantiers.chantiers
    .filter((chantier) => chantier.status !== "CANCELLED")
    .map((chantier) => {
      const matching = planning.actualHours.filter((entree) => entree.chantierId === chantier.id);
      const reel = actualHoursByActivity(matching);
      const weekActual = actualHoursByActivity(
        recorded.filter((entree) => entree.chantierId === chantier.id),
      );
      return {
        id: chantier.id,
        name: chantier.name,
        reference: chantier.reference,
        status: chantier.status,
        plannedHours: chantier.plannedHours,
        actualHours: reel,
        weekHours: weekActual,
        remainingHours: {
          be: chantier.plannedHours.be - reel.be,
          workshop: chantier.plannedHours.workshop - reel.workshop,
          install: chantier.plannedHours.install - reel.install,
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const chantierIds = new Set(chantierRows.map((chantier) => chantier.id));
  const suggestedChantierIds = scheduledChantiersByPerson(
    planning.dailyAssignments,
    semaine,
    chantierRows,
  );
  return {
    week: semaine,
    payrollWeekSignatures: Object.fromEntries(
      personnel.map((personne) => [
        personne.id,
        payrollWeekSignature(planning, personne.id, semaine),
      ]),
    ),
    editRevisions: planning.editRevisions ?? {},
    editHistory: (planning.editHistory ?? []).filter((entree) => entree.key.includes(semaine)),
    editable: contexte.moduleAccess.canWrite && canEnter && isPlanningWeekPast(semaine),
    weekIsPast: isPlanningWeekPast(semaine),
    people: personnel,
    chantiers: chantierRows,
    suggestedChantierIds,
    records: recorded
      .filter((entree) => chantierIds.has(entree.chantierId))
      .map((entree) => ({ ...entree, personName: parId.get(entree.userId) ?? "Personnel" })),
    indirectRecords: planning.indirectHours.filter((entree) => entree.week === semaine),
  };
}

export async function GET(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("planning", "READ");
    const semaine = actualHoursWeekSchema.parse(new URL(requete.url).searchParams.get("week"));
    return noStoreJson(await snapshot(semaine, contexte));
  } catch (erreur) {
    return reportError(erreur);
  }
}

export async function POST(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("planning", "WRITE");
    await requireSpecialPermission(contexte.user, "planning.enter_actual_hours");
    const raw = await requete.json();
    if (raw.action === "confirmPayrollWeek") {
      const saisie = z
        .object({
          userId: z.string().uuid(),
          week: actualHoursWeekSchema,
          expectedSignature: z.string().max(1000000),
        })
        .parse(raw);
      if (!isPlanningWeekPast(saisie.week)) throw new Error("PLANNING_ACTUAL_HOURS_WEEK_NOT_PAST");
      await createPlanningRepository().mutate((contenu) => {
        const signature = payrollWeekSignature(contenu, saisie.userId, saisie.week);
        if (signature !== saisie.expectedSignature) throw new Error("EDIT_VERSION_CONFLICT");
        return {
          ...contenu,
          payrollWeekConfirmations: {
            ...contenu.payrollWeekConfirmations,
            [saisie.userId + ":" + saisie.week]: signature,
          },
        };
      });
      return noStoreJson(await snapshot(saisie.week, contexte));
    }

    const saisie =
      raw?.action === "saveIndirectHoursRow"
        ? indirectHoursRowSchema.parse(raw)
        : actualHoursRowSchema.parse(raw);
    if (!isPlanningWeekPast(saisie.week)) throw new Error("PLANNING_ACTUAL_HOURS_WEEK_NOT_PAST");

    const [chantiers, auth] = await Promise.all([
      createChantiersRepository(contexte).load(),
      readAuthPayload(),
    ]);
    const chantierIds = new Set(
      chantiers.chantiers
        .filter((chantier) => chantier.status !== "CANCELLED")
        .map((chantier) => chantier.id),
    );
    await createPlanningRepository().mutate((contenu) => {
      const personnes = effectivePlanningPeople(contenu, auth.users);
      const identifiants = new Set(personnes.map((personne) => personne.userId));
      // Allow correcting historical entries of employees whose old login was disabled.
      const recordedIds = new Set(
        saisie.action === "saveActualHoursRow"
          ? contenu.actualHours
              .filter(
                (entree) => entree.chantierId === saisie.chantierId && entree.week === saisie.week,
              )
              .map((entree) => entree.userId)
          : contenu.indirectHours
              .filter(
                (entree) => entree.category === saisie.category && entree.week === saisie.week,
              )
              .map((entree) => entree.userId),
      );
      for (const utilisateur of auth.users) {
        if (recordedIds.has(utilisateur.id)) identifiants.add(utilisateur.id);
      }
      const cle =
        saisie.action === "saveIndirectHoursRow"
          ? `${saisie.week}:${saisie.userId}:indirect:${saisie.category}`
          : `${saisie.week}:${saisie.userId}:${saisie.chantierId}`;
      const revision = contenu.editRevisions?.[cle] ?? 0;
      assertEditRevision(raw.expectedRevision, revision);
      const before =
        saisie.action === "saveIndirectHoursRow"
          ? contenu.indirectHours.filter(
              (entree) =>
                entree.week === saisie.week &&
                entree.userId === saisie.userId &&
                entree.category === saisie.category,
            )
          : contenu.actualHours.filter(
              (entree) =>
                entree.week === saisie.week &&
                entree.userId === saisie.userId &&
                entree.chantierId === saisie.chantierId,
            );
      const suivant =
        saisie.action === "saveIndirectHoursRow"
          ? applyIndirectHoursRow(contenu, saisie, identifiants)
          : applyActualHoursRow(contenu, saisie, chantierIds, identifiants);
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
    return noStoreJson(await snapshot(saisie.week, contexte));
  } catch (erreur) {
    return reportError(erreur);
  }
}
