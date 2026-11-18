import { NextResponse } from "next/server";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { readPendingPurchaseInvoiceSummary } from "@/lib/pennylane/purchase-invoice-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Count visible outstanding invoices only for users authorized to view purchases. */
export async function GET() {
  try {
    await requireModuleRequestContext("purchases", "READ");
    if (isLocalStorageMode()) {
      return NextResponse.json(
        { imported: false, pending: 0, checked: 0, truncated: false, lastImportedAt: null },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(await readPendingPurchaseInvoiceSummary(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { error: "PURCHASE_INVOICE_SUMMARY_UNAVAILABLE" },
      {
        status: desktopRequestErrorStatus(code) ?? 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
