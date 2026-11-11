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
  buildPayrollSummary,
  getMonthState,
  mutatePayrollPreparation,
  parsePayrollPreparation,
  payrollDifferences,
} from "@/lib/payroll/preparation";
import {
  readPayrollPreparation,
  updatePayrollPreparation,
} from "@/lib/payroll/preparation-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(erreur: unknown) {
  const code =
    erreur instanceof ZodError
      ? "PAYROLL_PREPARATION_INVALID"
      : erreur instanceof Error
        ? erreur.message
        : "PAYROLL_PREPARATION_FAILED";
  return NextResponse.json(
    { error: code },
    {
      status:
        desktopRequestErrorStatus(code) ??
        (code.includes("CONFLICT") || code.includes("LOCKED") || code.includes("UNCHANGED")
          ? 409
          : 400),
    },
  );
}
async function dependencies() {
  const [planning, auth, stored] = await Promise.all([
    createPlanningRepository().load(),
    readAuthPayload(),
    readPayrollPreparation(),
  ]);
  return { planning, people: effectivePlanningPeople(planning, auth.users), stored };
}
function response(
  mois: string,
  donnees: Awaited<ReturnType<typeof dependencies>>,
  canWrite: boolean,
) {
  const etat = getMonthState(donnees.stored, mois);
  const courant = buildPayrollSummary(
    mois,
    donnees.planning,
    donnees.people,
    etat,
    donnees.stored.rules,
  );
  const latest = etat.versions.at(-1) ?? null;
  const diff = latest ? payrollDifferences(latest.summary, courant) : [];
  return NextResponse.json(
    {
      month: mois,
      canWrite,
      state: etat,
      current: courant,
      latest,
      differences: diff,
      rules: donnees.stored.rules,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(requete: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "READ");
    const mois = new URL(requete.url).searchParams.get("month") ?? "";
    return response(mois, await dependencies(), ctx.moduleAccess.canWrite);
  } catch (erreur) {
    return failure(erreur);
  }
}
export async function POST(requete: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "WRITE");
    const saisie = (await requete.json()) as Parameters<typeof mutatePayrollPreparation>[1];
    const { planning, people: personnes } = await dependencies();
    const stored = await updatePayrollPreparation((source) =>
      mutatePayrollPreparation(source, saisie, planning, personnes, ctx.user.displayName),
    );
    const mois = (saisie as { month: string }).month;
    return response(mois, { planning, people: personnes, stored }, true);
  } catch (erreur) {
    return failure(erreur);
  }
}
