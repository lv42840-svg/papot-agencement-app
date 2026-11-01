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

function failure(error: unknown) {
  const code =
    error instanceof ZodError
      ? "PAYROLL_PREPARATION_INVALID"
      : error instanceof Error
        ? error.message
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
  month: string,
  data: Awaited<ReturnType<typeof dependencies>>,
  canWrite: boolean,
) {
  const state = getMonthState(data.stored, month);
  const current = buildPayrollSummary(month, data.planning, data.people, state, data.stored.rules);
  const latest = state.versions.at(-1) ?? null;
  const diff = latest ? payrollDifferences(latest.summary, current) : [];
  return NextResponse.json(
    { month, canWrite, state, current, latest, differences: diff, rules: data.stored.rules },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(request: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "READ");
    const month = new URL(request.url).searchParams.get("month") ?? "";
    return response(month, await dependencies(), ctx.moduleAccess.canWrite);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "WRITE");
    const input = (await request.json()) as Parameters<typeof mutatePayrollPreparation>[1];
    const { planning, people } = await dependencies();
    const stored = await updatePayrollPreparation((source) =>
      mutatePayrollPreparation(source, input, planning, people, ctx.user.displayName),
    );
    const month = (input as { month: string }).month;
    return response(month, { planning, people, stored }, true);
  } catch (error) {
    return failure(error);
  }
}
