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

function parseYearRange(startYear: number, value: unknown): number {
  const endYear = yearSchema.parse(value ?? startYear);
  if (endYear < startYear || endYear - startYear > 2) {
    throw new Error("PLANNING_YEAR_RANGE_INVALID");
  }
  return endYear;
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
  if (code.includes("VERSION_CONFLICT")) return 409;
  if (code.includes("INVALID")) return 400;
  return 400;
}

async function snapshot(
  year: number,
  endYear: number,
  canWrite: boolean,
  user: { id: string },
  context: Awaited<ReturnType<typeof requireModuleRequestContext>>,
) {
  const [planning, chantiers, commercial, quotes, auth, canEditMacro, canManageSchedules] =
    await Promise.all([
      createPlanningRepository().load(),
      createChantiersRepository(context).load(),
      createCommercialRepository().load(),
      createQuotesRepository().load(),
      readAuthPayload(),
      hasEffectiveSpecialPermission(user, "planning.edit_macro"),
      hasEffectiveSpecialPermission(user, "planning.manage_schedules"),
    ]);
  const weeks = planningYearWeekIdsRange(year, endYear);
  const rows = buildFirmGrandPlanningRows(chantiers, planning, year, endYear);
  const provisionalRows = buildCommercialProvisionRows(
    commercial,
    planning,
    year,
    endYear,
    quotes.quotes,
  );
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

  const peopleCapacity = effectivePlanningPeople(planning, auth.users);
  const personNameById = new Map(
    peopleCapacity.map((person) => [person.userId, person.displayName]),
  );
  const accountNameById = new Map(
    auth.users.map((candidate) => [candidate.id, candidate.displayName]),
  );

  return {
    year,
    endYear,
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
      .filter(
        (absence) =>
          Number(absence.date.slice(0, 4)) >= year && Number(absence.date.slice(0, 4)) <= endYear,
      )
      .map((absence) => ({
        ...absence,
        displayName:
          personNameById.get(absence.userId) ?? accountNameById.get(absence.userId) ?? "Personnel",
        typeLabel: PLANNING_ABSENCE_TYPE_LABELS[absence.type],
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    peopleCapacity,
    availableAccounts:
      canWrite && canManageSchedules
        ? auth.users
            .filter((candidate) => candidate.isActive)
            .map((candidate) => ({ id: candidate.id, displayName: candidate.displayName }))
        : [],
    capabilities: {
      canRead: true,
      canEditMacro: canWrite && canEditMacro,
      canManageSchedules: canWrite && canManageSchedules,
    },
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireModuleRequestContext("planning", "READ");
    const url = new URL(request.url);
    const year = yearSchema.parse(url.searchParams.get("year") ?? new Date().getFullYear());
    const endYear = parseYearRange(year, url.searchParams.get("endYear"));
    return noStoreJson(
      await snapshot(year, endYear, context.moduleAccess.canWrite, context.user, context),
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
    const endYear = parseYearRange(year, body.endYear);
    const input = planningMutationSchema.parse(body);
    const context = await requireModuleRequestContext("planning", "WRITE");
    const planningRepository = createPlanningRepository();

    if (input.action === "setMacroHours") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      assertPlanningWeekEditable(input.week);
      const chantiers = await createChantiersRepository(context).load();
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      await planningRepository.mutate((payload) =>
        applyPlanningMacroMutation(payload, input, activeChantierIds),
      );
    } else if (input.action === "setHoursBatch") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      for (const update of input.updates) {
        assertPlanningWeekEditable(update.week);
        if (!planningYearWeekIdsRange(year, endYear).includes(update.week)) {
          throw new Error("PLANNING_BATCH_WEEK_INVALID");
        }
      }
      const [chantiers, commercial] = await Promise.all([
        createChantiersRepository(context).load(),
        createCommercialRepository().load(),
      ]);
      const activeChantierIds = new Set(
        chantiers.chantiers
          .filter((chantier) => chantier.status === "ACTIVE")
          .map((chantier) => chantier.id),
      );
      const activeCommercialCaseIds = new Set(
        commercial.cases.filter(isCommercialActive).map((item) => item.id),
      );
      await planningRepository.mutate((payload) =>
        applyPlanningHoursBatchMutation(payload, input, activeChantierIds, activeCommercialCaseIds),
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
      await planningRepository.mutate((payload) =>
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
      await planningRepository.mutate((payload) =>
        applyPlanningChantierOrderMutation(payload, input, activeChantierIds),
      );
    } else if (input.action === "setProvisionHours") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      assertPlanningWeekEditable(input.week);
      const commercial = await createCommercialRepository().load();
      const activeCommercialCaseIds = new Set(
        commercial.cases.filter(isCommercialActive).map((item) => item.id),
      );
      await planningRepository.mutate((payload) =>
        applyPlanningProvisionalMutation(payload, input, activeCommercialCaseIds),
      );
    } else if (input.action === "setPotentialOrder") {
      await requireSpecialPermission(context.user, "planning.edit_macro");
      const commercial = await createCommercialRepository().load();
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
      await planningRepository.mutate((payload) => {
        const activePotentialCaseIds = new Set(referenceCaseIds);
        for (const allocation of payload.provisionalAllocations) {
          if (activeCaseIds.has(allocation.caseId)) activePotentialCaseIds.add(allocation.caseId);
        }
        return applyPlanningPotentialOrderMutation(payload, input, activePotentialCaseIds);
      });
    } else {
      await requireSpecialPermission(context.user, "planning.manage_schedules");
      const auth = await readAuthPayload();
      if (input.action === "saveStaff" || input.action === "linkStaffAccount") {
        const activeAccounts = new Set(
          auth.users.filter((candidate) => candidate.isActive).map((candidate) => candidate.id),
        );
        await planningRepository.mutate((payload) =>
          applyPlanningStaffMutation(payload, input, activeAccounts),
        );
      } else if (input.action === "setPersonCapacity") {
        await planningRepository.mutate((payload) =>
          applyPlanningPersonCapacityMutation(
            payload,
            input,
            new Set(effectivePlanningPeople(payload, auth.users).map((person) => person.userId)),
          ),
        );
      } else if (input.action === "setAbsence") {
        await planningRepository.mutate((payload) =>
          applyPlanningAbsenceMutation(
            payload,
            input,
            new Set(effectivePlanningPeople(payload, auth.users).map((person) => person.userId)),
          ),
        );
      } else if (input.action === "setFullWeekAbsence") {
        await planningRepository.mutate((payload) =>
          applyPlanningFullWeekAbsenceMutation(
            payload,
            input,
            new Set(effectivePlanningPeople(payload, auth.users).map((person) => person.userId)),
          ),
        );
      } else if (input.action === "deleteAbsenceBatch") {
        await planningRepository.mutate((payload) =>
          applyPlanningDeleteAbsenceBatchMutation(payload, input),
        );
      } else {
        await planningRepository.mutate((payload) =>
          applyPlanningDeleteAbsenceMutation(payload, input),
        );
      }
    }

    return noStoreJson(await snapshot(year, endYear, true, context.user, context));
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
