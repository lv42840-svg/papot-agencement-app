import { NextResponse } from "next/server";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { readPennylaneStoredConfig } from "@/lib/pennylane/connection";
import { listPennylaneSupplierInvoiceLines, verifyPennylaneCompany } from "@/lib/pennylane/client";
import { euroToCents } from "@/lib/pennylane/purchase-allocations";
import { getServerDbPool } from "@/lib/server-db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    await requireModuleRequestContext("purchases", "READ");
    const { invoiceId } = await params;
    if (!/^\d{1,20}$/.test(invoiceId))
      return NextResponse.json({ error: "INVOICE_ID_INVALID" }, { status: 400 });
    const found = await getServerDbPool().query(
      "SELECT 1 FROM papot_pennylane_staging WHERE resource = 'supplier_invoices' AND external_id = $1",
      [invoiceId],
    );
    if (!found.rows[0])
      return NextResponse.json({ error: "INVOICE_NOT_IMPORTED" }, { status: 404 });
    const config = await readPennylaneStoredConfig();
    await verifyPennylaneCompany(config);
    const items = await listPennylaneSupplierInvoiceLines(invoiceId, config);
    const lines = items.map((item) => ({
      id: String(item.id),
      label: typeof item.label === "string" ? item.label : "Ligne " + item.id,
      amountHtCents: euroToCents(item.currency_amount_before_tax),
    }));
    return NextResponse.json({ lines }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVOICE_LINES_FAILED";
    return NextResponse.json(
      {
        error: ["AUTH_REQUIRED", "MODULE_FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(code)
          ? code
          : "INVOICE_LINES_UNAVAILABLE",
      },
      {
        status: desktopRequestErrorStatus(code) ?? 502,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
