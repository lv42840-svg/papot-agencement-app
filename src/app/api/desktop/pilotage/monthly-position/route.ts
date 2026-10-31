import { NextResponse } from "next/server";
import { hasModuleAccess, requireSpecialPermission } from "@/lib/auth/permissions";
import { requireModuleRequestContext, desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { readMonthlyLaborCosts } from "@/lib/payroll/monthly-labor-costs-repository";
import { parisCurrentMonth } from "@/lib/payroll/monthly-labor-costs";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";
import { committedPurchasesByDestination } from "@/lib/purchases/domain";
import { calculateMonthlyFinancialResult, financialMonthSchema } from "@/lib/pilotage/monthly-financial-result";
import { calculateMonthlyConsumption } from "@/lib/pilotage/monthly-consumption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const context = await requireModuleRequestContext("pilotage", "READ");
    await requireSpecialPermission(context.user, "dashboard.view_global");
    const now = new Date();
    const month = financialMonthSchema.parse(new URL(request.url).searchParams.get("month") ?? parisCurrentMonth(now));
    const [canReadPurchases, canReadPlanning, payrollAccess] = await Promise.all([
      hasModuleAccess(context.user.id, "purchases", "READ"),
      hasModuleAccess(context.user.id, "planning", "READ"),
      hasModuleAccess(context.user.id, "payroll", "READ"),
    ]);
    const canReadPayroll = canReadPlanning && payrollAccess;
    const [purchases, planning, payroll] = await Promise.all([
      canReadPurchases ? createPurchaseOrdersRepository().load() : Promise.resolve(null),
      canReadPlanning ? createPlanningRepository().load() : Promise.resolve(null),
      canReadPayroll ? readMonthlyLaborCosts() : Promise.resolve(null),
    ]);
    return NextResponse.json({
      month,
      asOf: now.toISOString(),
      sourcesConnected: false,
      // No provider exists yet. Never substitute approved drafts, BCs or a partial payroll.
      financial: calculateMonthlyFinancialResult({ month, customerInvoices: null, supplierInvoices: null, payroll: null }),
      commitments: purchases ? committedPurchasesByDestination(purchases) : null,
      consumption: planning ? calculateMonthlyConsumption(month, planning, payroll?.records ?? null, now) : null,
      canReadPurchases,
      canReadPlanning,
      canReadPayroll,
    }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MONTHLY_POSITION_FAILED";
    return NextResponse.json({ error: "Impossible de charger la situation mensuelle." }, {
      status: desktopRequestErrorStatus(code) ?? 400,
      headers,
    });
  }
}
