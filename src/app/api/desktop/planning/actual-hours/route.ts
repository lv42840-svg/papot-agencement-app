import { assertEditRevision } from "@/lib/edit-history";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
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

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
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

function reportError(error: unknown) {
  const code =
    error instanceof ZodError
      ? "PLANNING_ACTUAL_HOURS_INVALID"
      : error instanceof Error
        ? error.message
        : "PLANNING_ACTUAL_HOURS_FAILED";
  return noStoreJson({ error: code }, { status: statusFor(code) });
}

async function snapshot(
  week: string,
  context: Awaited<ReturnType<typeof requireModuleRequestContext>>,
) {
  const [planning, chantiers, auth, canEnter] = await Promise.all([
    createPlanningRepository().load(),
    createChantiersRepository(context).load(),
    readAuthPayload(),
    hasEffectiveSpecialPermission(context.user, "planning.enter_actual_hours"),
  ]);

  const people = effectivePlanningPeople(planning, auth.users);
  const byId = new Map(people.map((person) => [person.userId, person.displayName]));
  // Existing hours must remain readable after a legacy account is deactivated.
  for (const account of auth.users) {
    if (!byId.has(account.id)) byId.set(account.id, account.displayName);
  }
  const storedPeople = new Set([
    ...planning.actualHours.map((entry) => entry.userId),
    ...planning.indirectHours.map((entry) => entry.userId),
  ]);
  const personnel = [
    ...people.map((person) => ({
      id: person.userId,
      name: person.displayName,
      endDate: person.endDate,
      inactiveSince: person.inactiveSince,
    })),
    ...auth.users
      .filter(
        (person) =>
          storedPeople.has(person.id) && !people.some((active) => active.userId === person.id),
      )
      .map((person) => ({
        id: person.id,
        name: person.displayName,
        endDate: null,
        inactiveSince: null,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const recorded = planning.actualHours.filter((entry) => entry.week === week);
  const chantierRows = chantiers.chantiers
    .filter((chantier) => chantier.status !== "CANCELLED")
    .map((chantier) => {
      const matching = planning.actualHours.filter((entry) => entry.chantierId === chantier.id);
      const actual = actualHoursByActivity(matching);
      const weekActual = actualHoursByActivity(
        recorded.filter((entry) => entry.chantierId === chantier.id),
      );
      return {
        id: chantier.id,
        name: chantier.name,
        reference: chantier.reference,
        status: chantier.status,
        plannedHours: chantier.plannedHours,
        actualHours: actual,
        weekHours: weekActual,
        remainingHours: {
          be: chantier.plannedHours.be - actual.be,
          workshop: chantier.plannedHours.workshop - actual.workshop,
          install: chantier.plannedHours.install - actual.install,
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const chantierIds = new Set(chantierRows.map((chantier) => chantier.id));
  const suggestedChantierIds = scheduledChantiersByPerson(
    planning.dailyAssignments,
    week,
    chantierRows,
  );
  return {
    week,
    editRevisions: planning.editRevisions ?? {},
    editHistory: (planning.editHistory ?? []).filter((entry) => entry.key.includes(week)),
    editable: context.moduleAccess.canWrite && canEnter && isPlanningWeekPast(week),
    weekIsPast: isPlanningWeekPast(week),
    people: personnel,
    chantiers: chantierRows,
    suggestedChantierIds,
    records: recorded
      .filter((entry) => chantierIds.has(entry.chantierId))
      .map((entry) => ({ ...entry, personName: byId.get(entry.userId) ?? "Personnel" })),
    indirectRecords: planning.indirectHours.filter((entry) => entry.week === week),
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireModuleRequestContext("planning", "READ");
    const week = actualHoursWeekSchema.parse(new URL(request.url).searchParams.get("week"));
    return noStoreJson(await snapshot(week, context));
  } catch (error) {
    return reportError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("planning", "WRITE");
    await requireSpecialPermission(context.user, "planning.enter_actual_hours");
    const raw = await request.json();
    const input =
      raw?.action === "saveIndirectHoursRow"
        ? indirectHoursRowSchema.parse(raw)
        : actualHoursRowSchema.parse(raw);
    if (!isPlanningWeekPast(input.week)) throw new Error("PLANNING_ACTUAL_HOURS_WEEK_NOT_PAST");

    const [chantiers, auth] = await Promise.all([
      createChantiersRepository(context).load(),
      readAuthPayload(),
    ]);
    const chantierIds = new Set(
      chantiers.chantiers
        .filter((chantier) => chantier.status !== "CANCELLED")
        .map((chantier) => chantier.id),
    );
    await createPlanningRepository().mutate((payload) => {
      const people = effectivePlanningPeople(payload, auth.users);
      const ids = new Set(people.map((person) => person.userId));
      // Allow correcting historical entries of employees whose old login was disabled.
      const recordedIds = new Set(
        input.action === "saveActualHoursRow"
          ? payload.actualHours
              .filter((entry) => entry.chantierId === input.chantierId && entry.week === input.week)
              .map((entry) => entry.userId)
          : payload.indirectHours
              .filter((entry) => entry.category === input.category && entry.week === input.week)
              .map((entry) => entry.userId),
      );
      for (const user of auth.users) {
        if (recordedIds.has(user.id)) ids.add(user.id);
      }
      const key =
        input.action === "saveIndirectHoursRow"
          ? `${input.week}:${input.userId}:indirect:${input.category}`
          : `${input.week}:${input.userId}:${input.chantierId}`;
      const revision = payload.editRevisions?.[key] ?? 0;
      assertEditRevision(raw.expectedRevision, revision);
      const before =
        input.action === "saveIndirectHoursRow"
          ? payload.indirectHours.filter(
              (entry) =>
                entry.week === input.week &&
                entry.userId === input.userId &&
                entry.category === input.category,
            )
          : payload.actualHours.filter(
              (entry) =>
                entry.week === input.week &&
                entry.userId === input.userId &&
                entry.chantierId === input.chantierId,
            );
      const next =
        input.action === "saveIndirectHoursRow"
          ? applyIndirectHoursRow(payload, input, ids)
          : applyActualHoursRow(payload, input, chantierIds, ids);
      next.editRevisions = { ...payload.editRevisions, [key]: revision + 1 };
      next.editHistory = [
        ...(payload.editHistory ?? []),
        {
          key,
          revision: revision + 1,
          at: new Date().toISOString(),
          actorId: context.user.id,
          actorName: context.user.displayName,
          before,
          after: input,
        },
      ];
      return next;
    });
    return noStoreJson(await snapshot(input.week, context));
  } catch (error) {
    return reportError(error);
  }
}
