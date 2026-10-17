import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { readAuthPayload } from "@/lib/auth/store";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { effectivePlanningPeople } from "@/lib/planning/personnel";
import { buildWeeklyCapacityIndicators } from "@/lib/planning/capacity";
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
  weeklyBoardWeekSchema,
  workingDaysOfWeek,
  applyDailyAssignment,
  weekActivityHours,
} from "@/lib/planning/weekly-board";
import { assertPlanningWeekEditable, isPlanningWeekPast } from "@/lib/planning/time-markers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(value: unknown, init?: ResponseInit) {
  const response = NextResponse.json(value, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function sendError(error: unknown) {
  const code =
    error instanceof ZodError
      ? "PLANNING_WEEK_REQUEST_INVALID"
      : error instanceof Error
        ? error.message
        : "PLANNING_WEEK_FAILED";
  const status =
    desktopRequestErrorStatus(code) ??
    (code.includes("NOT_ACTIVE") || code.includes("CONFLICT") ? 409 : 400);
  return noStoreJson({ error: code }, { status });
}

async function weeklySnapshot(
  week: string,
  context: Awaited<ReturnType<typeof requireModuleRequestContext>>,
) {
  const [planning, chantiers, commercial, quotes, auth, canManage] = await Promise.all([
    createPlanningRepository().load(),
    createChantiersRepository(context).load(),
    createCommercialRepository().load(),
    createQuotesRepository().load(),
    readAuthPayload(),
    hasEffectiveSpecialPermission(context.user, "planning.manage_schedules"),
  ]);
  const year = Number(week.slice(0, 4));
  const firmRows = buildFirmGrandPlanningRows(chantiers, planning, year);
  const potentialRows = buildCommercialProvisionRows(
    commercial,
    planning,
    year,
    year,
    quotes.quotes,
  );
  // The small board must display the exact totals used in the grand planning.
  const firm = weekActivityHours(firmRows, week);
  const provisional = weekActivityHours(potentialRows, week);
  const people = effectivePlanningPeople(planning, auth.users);
  const dates = workingDaysOfWeek(week);
  const allSiteNames = new Map(chantiers.chantiers.map((site) => [site.id, site.name]));
  const assignments = planning.dailyAssignments
    .filter(
      (row) => dates.includes(row.date) && people.some((person) => person.userId === row.userId),
    )
    .map((row) => ({
      ...row,
      label: row.chantierId ? (allSiteNames.get(row.chantierId) ?? row.label) : row.label,
    }));
  const absences = planning.absences
    .filter((row) => dates.includes(row.date))
    .map((row) => ({
      ...row,
      typeLabel: PLANNING_ABSENCE_TYPE_LABELS[row.type],
    }));
  const capacity = buildWeeklyCapacityIndicators(
    [week],
    people,
    new Map([[week, firm.total]]),
    planning.absences,
    new Map([[week, provisional.total]]),
  )[0];
  return {
    week,
    dates,
    people: people.map((person) => ({
      userId: person.userId,
      displayName: person.displayName,
      countsInMacroCapacity: person.countsInMacroCapacity,
      weeklySchedule: person.weeklySchedule,
    })),
    sites: chantiers.chantiers
      .filter((site) => site.status === "ACTIVE")
      .map((site) => ({ id: site.id, name: site.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    assignments,
    absences,
    firm,
    provisional,
    capacity,
    editable: context.moduleAccess.canWrite && canManage && !isPlanningWeekPast(week),
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireModuleRequestContext("planning", "READ");
    const week = weeklyBoardWeekSchema.parse(new URL(request.url).searchParams.get("week"));
    return noStoreJson(await weeklySnapshot(week, context));
  } catch (error) {
    return sendError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("planning", "WRITE");
    await requireSpecialPermission(context.user, "planning.manage_schedules");
    const input = weeklyBoardAssignmentSchema.parse(await request.json());
    assertPlanningWeekEditable(input.week);
    const [auth, chantiers] = await Promise.all([
      readAuthPayload(),
      createChantiersRepository(context).load(),
    ]);
    const activeSites = chantiers.chantiers
      .filter((site) => site.status === "ACTIVE")
      .map((site) => ({ id: site.id, name: site.name }));
    await createPlanningRepository().mutate((payload) => {
      const people = effectivePlanningPeople(payload, auth.users);
      return applyDailyAssignment(
        payload,
        input,
        new Set(people.map((person) => person.userId)),
        activeSites,
      );
    });
    return noStoreJson(await weeklySnapshot(input.week, context));
  } catch (error) {
    return sendError(error);
  }
}
