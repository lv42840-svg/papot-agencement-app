import { NextResponse } from "next/server";
import { hasModuleAccess, requireSpecialPermission } from "@/lib/auth/permissions";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { readMonthlyLaborCosts } from "@/lib/payroll/monthly-labor-costs-repository";
import { parisCurrentMonth } from "@/lib/payroll/monthly-labor-costs";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";
import { committedPurchasesByDestination } from "@/lib/purchases/domain";
import {
  calculateMonthlyFinancialResult,
  financialMonthSchema,
} from "@/lib/pilotage/monthly-financial-result";
import { calculateMonthlyConsumption } from "@/lib/pilotage/monthly-consumption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const entetes = { "Cache-Control": "private, no-store" };

export async function GET(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("pilotage", "READ");
    await requireSpecialPermission(contexte.user, "dashboard.view_global");
    const maintenant = new Date();
    const mois = financialMonthSchema.parse(
      new URL(requete.url).searchParams.get("month") ?? parisCurrentMonth(maintenant),
    );
    const [canReadPurchases, canReadPlanning, payrollAccess] = await Promise.all([
      hasModuleAccess(contexte.user.id, "purchases", "READ"),
      hasModuleAccess(contexte.user.id, "planning", "READ"),
      hasModuleAccess(contexte.user.id, "payroll", "READ"),
    ]);
    const canReadPayroll = canReadPlanning && payrollAccess;
    const [purchases, planning, payroll] = await Promise.all([
      canReadPurchases ? createPurchaseOrdersRepository().load() : Promise.resolve(null),
      canReadPlanning ? createPlanningRepository().load() : Promise.resolve(null),
      canReadPayroll ? readMonthlyLaborCosts() : Promise.resolve(null),
    ]);
    return NextResponse.json(
      {
        month: mois,
        asOf: maintenant.toISOString(),
        sourcesConnected: false,
        // No provider exists yet. Never substitute approved drafts, BCs or a partial payroll.
        financial: calculateMonthlyFinancialResult({
          month: mois,
          customerInvoices: null,
          supplierInvoices: null,
          payroll: null,
        }),
        commitments: purchases ? committedPurchasesByDestination(purchases) : null,
        consumption: planning
          ? calculateMonthlyConsumption(mois, planning, payroll?.records ?? null, maintenant)
          : null,
        canReadPurchases,
        canReadPlanning,
        canReadPayroll,
      },
      { headers: entetes },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "MONTHLY_POSITION_FAILED";
    return NextResponse.json(
      { error: "Impossible de charger la situation mensuelle." },
      {
        status: desktopRequestErrorStatus(code) ?? 400,
        headers: entetes,
      },
    );
  }
}
