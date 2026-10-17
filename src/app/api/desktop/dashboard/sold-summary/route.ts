import { NextResponse } from "next/server";
import { hasModuleAccess, requireSpecialPermission } from "@/lib/auth/permissions";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { calculateDashboardSoldSummary } from "@/lib/dashboard/sold-summary";
import {
  calculateIndicativeCompanyMarginCents,
  calculateIndirectLaborCostsForPeriod,
} from "@/lib/payroll/indirect-labor-cost";
import { readMonthlyLaborCosts } from "@/lib/payroll/monthly-labor-costs-repository";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireModuleRequestContext("pilotage", "READ");
    await requireSpecialPermission(context.user, "dashboard.view_global");
    await Promise.all([
      requireModuleRequestContext("commercial", "READ"),
      requireModuleRequestContext("quotes", "READ"),
    ]);

    const [commercial, quotes] = await Promise.all([
      createCommercialRepository().load(),
      createQuotesRepository().load(),
    ]);

    const sales = calculateDashboardSoldSummary(commercial.cases, quotes.quotes);
    // Do not expose salary-derived SAV / overhead costs to users without Paie access.
    const canReadPayroll = await hasModuleAccess(context.user.id, "payroll", "READ");
    if (!canReadPayroll) {
      return NextResponse.json(
        { ...sales, indirect: null },
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    const [planning, payroll] = await Promise.all([
      createPlanningRepository().load(),
      readMonthlyLaborCosts(),
    ]);
    const yearly = calculateIndirectLaborCostsForPeriod(
      sales.year,
      planning.indirectHours,
      payroll.records,
      planning.peopleCapacity,
    );
    const monthly = calculateIndirectLaborCostsForPeriod(
      sales.month,
      planning.indirectHours,
      payroll.records,
      planning.peopleCapacity,
    );
    return NextResponse.json(
      {
        ...sales,
        indirect: {
          yearly,
          monthly,
          indicativeYearlyMarginCents: calculateIndicativeCompanyMarginCents(
            sales.yearly.plannedMarginCents,
            yearly,
          ),
          indicativeMonthlyMarginCents: calculateIndicativeCompanyMarginCents(
            sales.monthly.plannedMarginCents,
            monthly,
          ),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "DASHBOARD_SOLD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: desktopRequestErrorStatus(code) ?? 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
