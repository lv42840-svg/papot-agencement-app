import { assertEditRevision } from "@/lib/edit-history";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { effectivePlanningPeople } from "@/lib/planning/personnel";
import { readAuthPayload } from "@/lib/auth/store";
import {
  monthlyLaborCostInputSchema,
  monthlyHourlyRateEuro,
  saveMonthlyLaborCost,
} from "@/lib/payroll/monthly-labor-costs";
import { holdingRecordedHoursForMonth } from "@/lib/payroll/holding-hours";
import {
  readMonthlyLaborCosts,
  mutateMonthlyLaborCosts,
} from "@/lib/payroll/monthly-labor-costs-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(erreur: unknown) {
  const code =
    erreur instanceof ZodError
      ? "MONTHLY_LABOR_COST_INVALID"
      : erreur instanceof Error
        ? erreur.message
        : "MONTHLY_LABOR_COST_FAILED";
  return NextResponse.json(
    { error: code },
    {
      status:
        desktopRequestErrorStatus(code) ??
        (code.includes("NOT_FOUND")
          ? 404
          : code.includes("NOT_CLOSED") || code.includes("CONFLICT")
            ? 409
            : 400),
    },
  );
}

async function snapshot(mois: string, editable: boolean) {
  const [planning, auth, ledger] = await Promise.all([
    createPlanningRepository().load(),
    readAuthPayload(),
    readMonthlyLaborCosts(),
  ]);
  const personnes = effectivePlanningPeople(planning, auth.users);
  const parId = new Map(personnes.map((personne) => [personne.userId, personne.displayName]));
  const registeredIds = new Set(ledger.records.map((element) => element.personId));
  for (const utilisateur of auth.users)
    if (registeredIds.has(utilisateur.id) && !parId.has(utilisateur.id))
      parId.set(utilisateur.id, utilisateur.displayName);
  for (const staff of planning.staff)
    if (registeredIds.has(staff.id) && !parId.has(staff.id))
      parId.set(staff.id, staff.firstName + " " + staff.lastName);
  return {
    month: mois,
    editRevisions: ledger.editRevisions ?? {},
    editHistory: (ledger.editHistory ?? []).filter((entree) => entree.key.startsWith(mois + ":")),
    editable,
    people: [...parId]
      .map(([id, nom]) => ({
        id,
        name: nom,
        holdingHours: holdingRecordedHoursForMonth(mois, id, planning, personnes),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    history: ledger.history.filter((entree) => entree.month === mois),
    records: ledger.records
      .filter((ligneTableau) => ligneTableau.month === mois)
      .map((ligneTableau) => ({
        ...ligneTableau,
        derivedHoldingHours:
          ligneTableau.sourceType === "HOLDING"
            ? holdingRecordedHoursForMonth(mois, ligneTableau.personId, planning, personnes)
            : null,
        hourlyRateEuro: monthlyHourlyRateEuro(ligneTableau),
      })),
  };
}

export async function GET(requete: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "READ");
    const mois = new URL(requete.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(mois)) throw new Error("MONTHLY_LABOR_COST_MONTH_INVALID");
    return NextResponse.json(await snapshot(mois, ctx.moduleAccess.canWrite), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erreur) {
    return failure(erreur);
  }
}

export async function POST(requete: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "WRITE");
    const raw = await requete.json();
    const saisie = monthlyLaborCostInputSchema.parse(raw);
    const [planning, auth] = await Promise.all([
      createPlanningRepository().load(),
      readAuthPayload(),
    ]);
    const personnes = effectivePlanningPeople(planning, auth.users);
    const identifiants = new Set(personnes.map((p) => p.userId));
    for (const personne of planning.staff) identifiants.add(personne.id);
    const historical = await readMonthlyLaborCosts();
    for (const enregistrement of historical.records) identifiants.add(enregistrement.personId);
    if (saisie.expectedRevision === undefined)
      throw new Error("MONTHLY_LABOR_COST_VERSION_REQUIRED");
    const selectionne =
      saisie.sourceType === "HOLDING"
        ? {
            ...saisie,
            workedHours: holdingRecordedHoursForMonth(
              saisie.month,
              saisie.personId,
              planning,
              personnes,
            ),
          }
        : saisie;
    await mutateMonthlyLaborCosts((source) => {
      const cle = `${saisie.month}:${saisie.personId}`;
      const revision = source.editRevisions?.[cle] ?? 0;
      assertEditRevision(raw.expectedRevision, revision);
      const before =
        source.records.find(
          (ligneTableau) =>
            ligneTableau.month === saisie.month && ligneTableau.personId === saisie.personId,
        ) ?? null;
      const suivant = saveMonthlyLaborCost(
        source,
        { ...selectionne, expectedRevision: before?.revision ?? null },
        identifiants,
        ctx.user.displayName,
      );
      suivant.editRevisions = { ...source.editRevisions, [cle]: revision + 1 };
      suivant.editHistory = [
        ...(source.editHistory ?? []),
        {
          key: cle,
          revision: revision + 1,
          at: new Date().toISOString(),
          actorId: ctx.user.id,
          actorName: ctx.user.displayName,
          before,
          after: saisie,
        },
      ];
      return suivant;
    });
    return NextResponse.json(await snapshot(saisie.month, true), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erreur) {
    return failure(erreur);
  }
}
