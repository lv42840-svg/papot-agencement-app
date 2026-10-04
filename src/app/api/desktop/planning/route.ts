import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { readAuthPayload } from "@/lib/auth/store";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialActive } from "@/lib/commercial/domain";
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
import {
  buildCommercialProvisionRows,
  buildFirmGrandPlanningRows,
  PLANNING_ABSENCE_TYPE_LABELS,
  planningYearWeekIds,
  type PlanningPayload,
} from "@/lib/planning/domain";
import { assertPlanningWeekEditable, isPlanningWeekPast } from "@/lib/planning/time-markers";
import {
  applyPlanningAbsenceMutation,
  applyPlanningActualHoursMutation,
  applyPlanningChantierOrderMutation,
  applyPlanningDeleteAbsenceMutation,
  applyPlanningFullWeekAbsenceMutation,
  applyPlanningMacroMutation,
  applyPlanningPersonCapacityMutation,
  applyPlanningPotentialOrderMutation,
  applyPlanningProvisionalMutation,
  planningMutationSchema,
} from "@/lib/planning/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const yearSchema = z.coerce.number().int().min(2020).max(2100);

function planningRevision(payload: PlanningPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
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
  if (code === "PLANNING_VERSION_REQUIRED") return 428;
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
  const [planning, chantiers, commercial, auth, canEditMacro, canManageSchedules] =
    await Promise.all([
      createPlanningRepository().load(),
      createChantiersRepository(context).load(),
      createCommercialRepository(context).load(),
      readAuthPayload(),
      hasEffectiveSpecialPermission(user, "planning.edit_macro"),
      hasEffectiveSpecialPermission(user, "planning.manage_schedules"),
    ]);
  const weeks = planningYearWeekIds(year);
  const rows = buildFirmGrandPlanningRows(chantiers, planning, year);
  const provisionalRows = buildCommercialProvisionRows(commercial, planning, year);
  const firmLoadByWeek = new Map<string, number>();
  const provisionalLoadByWeek = new Map<string, number>();

  for (const row of rows) {
    for (const activity of row.activities) {
      for (const [week, hours] of Object.entries(activity.weeklyHours)) {
        firmLoadByWeek.set(week, (firmLoadByWeek.get(week) ?? 0) + hours);
      }
    }
  }

  for (const row of provisionalRows) {
    for (const activity of row.activities) {
      for (const [week, hours] of Object.entries(activity.weeklyHours)) {
        provisionalLoadByWeek.set(week, (provisionalLoadByWeek.get(week) ?? 0) + hours);
      }
    }
  }

  const peopleCapacity = effectivePeopleCapacity(planning.peopleCapacity, auth.users);
  const userById = new Map(auth.users.map((candidate) => [candidate.id, candidate]));

  return {
    year,
    revision: planningRevision(planning),
    weeks,
    rows,
    provisionalRows,
    weeklyCapacity: buildWeeklyCapacityIndicators(
      weeks,
      peopleCapacity,
      firmLoadByWeek,
      planning.absences,
      provisionalLoadByWeek,
    ),
    absences: planning.absences
      .filter((absence) => absence.date.startsWith(String(year)))
      .map((absence) => ({
        ...absence,
        displayName: userById.get(absence.userId)?.displayName ?? "Utilisateur",
        typeLabel: PLANNING_ABSENCE_TYPE_LABELS[absence.type],
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
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
    const body = (await request.json()) as Record<string, unknown>;
    const year = yearSchema.parse(body.year ?? new Date().getFullYear());
    const input = planningMutationSchema.parse(body);
    const expectedRevision =
      typeof body.expectedRevision === "string"
        ? body.expectedRevision.trim()
        : "";
    if (!expectedRevision) throw new Error("PLANNING_VERSION_REQUIRED");
    const context = await requireDesktopRequestContext("planning", "WRITE");
    const planningRepository = createPlanningRepository();
    const mutatePlanning = async (
      transform: (
        payload: PlanningPayload,
      ) => PlanningPayload | Promise<PlanningPayload>,
    ) =>
      planningRepository.mutate(async (payload) => {
        if (planningRevision(payload) !== expectedRevision) {
          throw new Error("PLANNING_VERSION_CONFLICT");
        }
        return transform(payload);
      });

    if (input.action === "setMacroHours") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      assertPlanningWeekEditable(input.week);
      const chantiers = await createChantiersRepository(context).load();
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      await mutatePlanning((payload) =>
        applyPlanningMacroMutation(payload, input, activeChantierIds),
      );
    } else if (input.action === "setActualHours") {
      await requireSpecialPermission(context.user, "planning.enter_actual_hours");
      if (!isPlanningWeekPast(input.week)) throw new Error("PLANNING_ACTUAL_HOURS_WEEK_NOT_PAST");
      const [chantiers, auth] = await Promise.all([
        createChantiersRepository(context).load(),
        readAuthPayload(),
      ]);
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      const activeUserIds = new Set(
        auth.users.filter((candidate) => candidate.isActive).map((candidate) => candidate.id),
      );
      await mutatePlanning((payload) =>
        applyPlanningActualHoursMutation(payload, input, activeChantierIds, activeUserIds),
      );
    } else if (input.action === "setChantierOrder") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      const chantiers = await createChantiersRepository(context).load();
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      await mutatePlanning((payload) =>
        applyPlanningChantierOrderMutation(payload, input, activeChantierIds),
      );
    } else if (input.action === "setProvisionHours") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      assertPlanningWeekEditable(input.week);
      const commercial = await createCommercialRepository(context).load();
      const activeCommercialCaseIds = new Set(
        commercial.cases.filter(isCommercialActive).map((item) => item.id),
      );
      await mutatePlanning((payload) =>
        applyPlanningProvisionalMutation(payload, input, activeCommercialCaseIds),
      );
    } else if (input.action === "setPotentialOrder") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      const commercial = await createCommercialRepository(context).load();
      const activeCases = commercial.cases.filter(isCommercialActive);
      const activeCaseIds = new Set(activeCases.map((item) => item.id));
      const referenceCaseIds = new Set(
        activeCases
          .filter(
            (item) =>
              item.provisionHours.be > 0 ||
              item.provisionHours.workshop > 0 ||
              item.provisionHours.install > 0,
          )
          .map((item) => item.id),
      );
      await mutatePlanning((payload) => {
        const activePotentialCaseIds = new Set(referenceCaseIds);
        for (const allocation of payload.provisionalAllocations) {
          if (activeCaseIds.has(allocation.caseId)) activePotentialCaseIds.add(allocation.caseId);
        }
        return applyPlanningPotentialOrderMutation(payload, input, activePotentialCaseIds);
      });
    } else {
      await requireSpecialPermission(context.user, "planning.manage_schedules");
      const auth = await readAuthPayload();
      const activeUserIds = new Set(
        auth.users.filter((candidate) => candidate.isActive).map((candidate) => candidate.id),
      );

      if (input.action === "setPersonCapacity") {
        await mutatePlanning((payload) =>
          applyPlanningPersonCapacityMutation(payload, input, activeUserIds),
        );
      } else if (input.action === "setAbsence") {
        await mutatePlanning((payload) =>
          applyPlanningAbsenceMutation(payload, input, activeUserIds),
        );
      } else if (input.action === "setFullWeekAbsence") {
        await mutatePlanning((payload) =>
          applyPlanningFullWeekAbsenceMutation(payload, input, activeUserIds),
        );
      } else {
        await mutatePlanning((payload) =>
          applyPlanningDeleteAbsenceMutation(payload, input),
        );
      }
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
