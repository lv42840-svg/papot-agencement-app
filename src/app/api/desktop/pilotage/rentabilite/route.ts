import { NextResponse } from "next/server";
import { hasModuleAccess, requireSpecialPermission } from "@/lib/auth/permissions";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { calculateChantierLaborCostEstimate } from "@/lib/payroll/chantier-labor-cost";
import { readMonthlyLaborCosts } from "@/lib/payroll/monthly-labor-costs-repository";
import { actualHoursByActivity } from "@/lib/planning/actual-hours";
import { calculateCompanyProfitability } from "@/lib/pilotage/company-profitability";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireModuleRequestContext("pilotage", "READ");
    await requireSpecialPermission(context.user, "dashboard.view_global");
    await Promise.all([
      requireModuleRequestContext("chantiers", "READ"),
      requireModuleRequestContext("commercial", "READ"),
      requireModuleRequestContext("quotes", "READ"),
      requireModuleRequestContext("purchases", "READ"),
    ]);

    const canReadPayroll = await hasModuleAccess(context.user.id, "payroll", "READ");
    const [sites, commercial, quotes, purchases, planning, payroll] = await Promise.all([
      createChantiersRepository().load(),
      createCommercialRepository().load(),
      createQuotesRepository().load(),
      createPurchaseOrdersRepository().load(),
      createPlanningRepository().load(),
      canReadPayroll ? readMonthlyLaborCosts() : Promise.resolve(null),
    ]);
    const hoursBySite = new Map(
      sites.chantiers.map((site) => [
        site.id,
        actualHoursByActivity(planning.actualHours.filter((entry) => entry.chantierId === site.id)),
      ]),
    );
    // Salary-derived hourly costs are never returned without the Paie READ right.
    const now = new Date();
    const laborBySite = payroll
      ? new Map(
          sites.chantiers.map((site) => [
            site.id,
            calculateChantierLaborCostEstimate(
              site.id,
              planning.actualHours,
              payroll.records,
              planning.peopleCapacity,
              now,
            ),
          ]),
        )
      : new Map();
    const rows = calculateCompanyProfitability(
      sites.chantiers,
      commercial.cases,
      quotes,
      purchases,
      hoursBySite,
      laborBySite,
    );
    return NextResponse.json({ rows, canReadPayroll }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMPANY_PROFITABILITY_FAILED";
    return NextResponse.json(
      { error: code },
      { status: desktopRequestErrorStatus(code) ?? 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
