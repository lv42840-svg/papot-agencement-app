import { NextResponse } from "next/server";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { calculateDashboardSoldSummary } from "@/lib/dashboard/sold-summary";
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

    return NextResponse.json(
      calculateDashboardSoldSummary(commercial.cases, quotes.quotes),
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
