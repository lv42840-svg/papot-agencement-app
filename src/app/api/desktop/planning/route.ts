import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { readAuthPayload } from "@/lib/auth/store";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import {
  buildWeeklyCapacityIndicators,
  DEFAULT_WEEKLY_SCHEDULE,
  type PlanningPersonCapacity,
} from "@/lib/planning/capacity";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { buildFirmGrandPlanningRows, planningYearWeekIds } from "@/lib/planning/domain";
import {
  applyPlanningMacroMutation,
  applyPlanningPersonCapacityMutation,
  planningMutationSchema,
} from "@/lib/planning/mutations";

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
  if (code === "PLANNING_CHANTIER_NOT_ACTIVE" || code === "PLANNING_USER_NOT_ACTIVE") return 409;
  if (code.includes("VERSION_CONFLICT")) return 409;
  if (code.includes("INVALID")) return 400;
  return 400;
}

function effectivePeopleCapacity(
  planningPeople: PlanningPersonCapacity[],
  users: Awaited<ReturnType<typeof readAuthPayload>>["users"],
): PlanningPersonCapacity[] {
  const configured = new Map(planningPeople.map((person) => [person.userId, person]));
  return users
    .filter((user) => user.isActive)
    .map(
      (user): PlanningPersonCapacity =>
        configured.get(user.id) ?? {
          userId: user.id,
          countsInMacroCapacity: false,
          weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
        },
    );
}

async function snapshot(
  year: number,
  canWrite: boolean,
  user: { id: string },
  context: Awaited<ReturnType<typeof requireDesktopRequestContext>>,
) {
  const [planning, chantiers, auth, canEditMacro, canManageSchedules] = await Promise.all([
    createPlanningRepository().load(),
    createChantiersRepository(context).load(),
    readAuthPayload(),
    hasEffectiveSpecialPermission(user, "planning.edit_macro"),
    hasEffectiveSpecialPermission(user, "planning.manage_schedules"),
  ]);
  const weeks = planningYearWeekIds(year);
  const rows = buildFirmGrandPlanningRows(chantiers, planning, year);
  const firmLoadByWeek = new Map<string, number>();

  for (const row of rows) {
    for (const activity of row.activities) {
      for (const [week, hours] of Object.entries(activity.weeklyHours)) {
        firmLoadByWeek.set(week, (firmLoadByWeek.get(week) ?? 0) + hours);
      }
    }
  }

  const peopleCapacity = effectivePeopleCapacity(planning.peopleCapacity, auth.users);
  const userById = new Map(auth.users.map((candidate) => [candidate.id, candidate]));

  return {
    year,
    weeks,
    rows,
    weeklyCapacity: buildWeeklyCapacityIndicators(weeks, peopleCapacity, firmLoadByWeek),
    peopleCapacity: peopleCapacity.map((person) => ({
      ...person,
      displayName: userById.get(person.userId)?.displayName ?? "Utilisateur",
    })),
    capabilities: {
      canRead: true,
      canEditMacro: canWrite && canEditMacro,
      canManageSchedules: canWrite && canManageSchedules,
    },
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireDesktopRequestContext("planning", "READ");
    const url = new URL(request.url);
    const year = yearSchema.parse(url.searchParams.get("year") ?? new Date().getFullYear());
    return noStoreJson(await snapshot(year, context.moduleAccess.canWrite, context.user, context));
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
    const input = planningMutationSchema.parse(body);
    const context = await requireDesktopRequestContext("planning", "WRITE");
    const planningRepository = createPlanningRepository();

    if (input.action === "setMacroHours") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      const chantiers = await createChantiersRepository(context).load();
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      await planningRepository.mutate((payload) =>
        applyPlanningMacroMutation(payload, input, activeChantierIds),
      );
    } else {
      await requireSpecialPermission(context.user, "planning.manage_schedules");
      const auth = await readAuthPayload();
      const activeUserIds = new Set(
        auth.users.filter((candidate) => candidate.isActive).map((candidate) => candidate.id),
      );
      await planningRepository.mutate((payload) =>
        applyPlanningPersonCapacityMutation(payload, input, activeUserIds),
      );
    }

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
