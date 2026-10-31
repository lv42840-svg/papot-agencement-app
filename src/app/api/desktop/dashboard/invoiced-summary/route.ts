import { NextResponse } from "next/server";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import { requireModuleRequestContext, desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { summarizeIssuedInvoices } from "@/lib/billing/issued-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pennylane's issued-invoice ledger is not connected yet.
 * Do not take a provisional billing draft, signed quote or approved internal
 * project as a substitute. Once a verified provider is available, pass its
 * issued invoice / credit-note records to summarizeIssuedInvoices.
 */
export async function GET() {
  try {
    const context = await requireModuleRequestContext("pilotage", "READ");
    await requireSpecialPermission(context.user, "dashboard.view_global");
    await requireModuleRequestContext("billing", "READ");
    return NextResponse.json(
      summarizeIssuedInvoices([], false),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVOICED_SUMMARY_UNAVAILABLE";
    return NextResponse.json(
      { error: code },
      { status: desktopRequestErrorStatus(code) ?? 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
