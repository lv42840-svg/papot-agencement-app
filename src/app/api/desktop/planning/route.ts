import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import {
  hasEffectiveSpecialPermission,
  requireSpecialPermission,
} from "@/lib/auth/permissions";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import {
  buildFirmGrandPlanningRows,
  planningYearWeekIds,
} from "@/lib/planning/domain";
import {
  planningMacroMutationSchema,
  applyPlanningMacroMutation,
} from "@/lib/planning/mutations";
import { createPlanningRepository } from "@/lib/planning/create-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const yearSchema = z.coerce.number().int().min(2020).max(2100);

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "PLANNING_CHANTIER_NOT_ACTIVE") return 409;
  if (code.includes("VERSION_CONFLICT")) return 409;
  if (code.includes("INVALID")) return 400;
  return 400;
}

async function snapshot(
  year: number,
  canWrite: boolean,
  user: { id: string },
  context: Awaited<ReturnType<typeof requireDesktopRequestContext>>,
) {
  const [planning, chantiers, canEditMacro] = await Promise.all([
    createPlanningRepository().load(),
    createChantiersRepository(context).load(),
    hasEffectiveSpecialPermission(user, "planning.edit_macro"),
  ]);

  return {
    year,
    weeks: planningYearWeekIds(year),
    rows: buildFirmGrandPlanningRows(chantiers, planning, year),
    capabilities: {
      canRead: true,
      canEditMacro: canWrite && canEditMacro,
    },
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireDesktopRequestContext("planning", "READ");
    const url = new URL(request.url);
    const year = yearSchema.parse(
      url.searchParams.get("year") ?? new Date().getFullYear(),
    );
    return noStoreJson(
      await snapshot(year, context.moduleAccess.canWrite, context.user, context),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "PLANNING_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "PLANNING_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const year = yearSchema.parse(body.year ?? new Date().getFullYear());
    const input = planningMacroMutationSchema.parse(body);
    const context = await requireDesktopRequestContext("planning", "WRITE");
    await requireSpecialPermission(context.user, "planning.edit_macro");

    const chantiersRepository = createChantiersRepository(context);
    const chantiers = await chantiersRepository.load();
    const activeChantierIds = new Set(
      chantiers.chantiers
        .filter((chantier) => chantier.status === "ACTIVE")
        .map((chantier) => chantier.id),
    );

    const planningRepository = createPlanningRepository();
    await planningRepository.mutate((payload) =>
      applyPlanningMacroMutation(payload, input, activeChantierIds),
    );

    return noStoreJson(await snapshot(year, true, context.user, context));
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "PLANNING_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "PLANNING_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}
