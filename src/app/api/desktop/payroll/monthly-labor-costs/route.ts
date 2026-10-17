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
  assertClosedMonth,
  monthlyLaborCostInputSchema,
  monthlyHourlyRateEuro,
  saveMonthlyLaborCost,
} from "@/lib/payroll/monthly-labor-costs";
import {
  readMonthlyLaborCosts,
  mutateMonthlyLaborCosts,
} from "@/lib/payroll/monthly-labor-costs-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const code =
    error instanceof ZodError
      ? "MONTHLY_LABOR_COST_INVALID"
      : error instanceof Error
        ? error.message
        : "MONTHLY_LABOR_COST_FAILED";
  return NextResponse.json(
    { error: code },
    {
      status:
        desktopRequestErrorStatus(code) ??
        (code.includes("NOT_FOUND") ? 404 : code.includes("NOT_CLOSED") ? 409 : 400),
    },
  );
}

async function snapshot(month: string, editable: boolean) {
  const [planning, auth, ledger] = await Promise.all([
    createPlanningRepository().load(),
    readAuthPayload(),
    readMonthlyLaborCosts(),
  ]);
  const people = effectivePlanningPeople(planning, auth.users);
  const byId = new Map(people.map((person) => [person.userId, person.displayName]));
  const registeredIds = new Set(ledger.records.map((item) => item.personId));
  for (const user of auth.users)
    if (registeredIds.has(user.id) && !byId.has(user.id)) byId.set(user.id, user.displayName);
  for (const staff of planning.staff)
    if (registeredIds.has(staff.id) && !byId.has(staff.id))
      byId.set(staff.id, staff.firstName + " " + staff.lastName);
  return {
    month,
    editable,
    people: [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    records: ledger.records
      .filter((row) => row.month === month)
      .map((row) => ({
        ...row,
        hourlyRateEuro: monthlyHourlyRateEuro(row),
      })),
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "READ");
    const month = new URL(request.url).searchParams.get("month") ?? "";
    assertClosedMonth(month);
    return NextResponse.json(await snapshot(month, ctx.moduleAccess.canWrite), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireModuleRequestContext("payroll", "WRITE");
    const input = monthlyLaborCostInputSchema.parse(await request.json());
    const [planning, auth] = await Promise.all([
      createPlanningRepository().load(),
      readAuthPayload(),
    ]);
    const people = effectivePlanningPeople(planning, auth.users);
    const ids = new Set(people.map((p) => p.userId));
    for (const person of planning.staff) ids.add(person.id);
    const historical = await readMonthlyLaborCosts();
    for (const record of historical.records) ids.add(record.personId);
    await mutateMonthlyLaborCosts((source) =>
      saveMonthlyLaborCost(source, input, ids, ctx.user.displayName),
    );
    return NextResponse.json(await snapshot(input.month, true), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
