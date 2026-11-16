import { NextResponse } from "next/server";
import { requireModuleRequestContext, desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { readPennylaneStoredConfig } from "@/lib/pennylane/connection";
import { getPennylaneSupplierInvoice, verifyPennylaneCompany } from "@/lib/pennylane/client";
import { getServerDbPool } from "@/lib/server-db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    await requireModuleRequestContext("purchases", "READ");
    const { invoiceId } = await params;
    if (!/^\d{1,20}$/.test(invoiceId)) {
      return NextResponse.json({ error: "INVOICE_ID_INVALID" }, { status: 400 });
    }
    const found = await getServerDbPool().query(
      "SELECT 1 FROM papot_pennylane_staging WHERE resource = 'supplier_invoices' AND external_id = $1",
      [invoiceId],
    );
    if (!found.rows[0]) return NextResponse.json({ error: "INVOICE_NOT_IMPORTED" }, { status: 404 });
    const config = await readPennylaneStoredConfig();
    await verifyPennylaneCompany(config);
    const data = await getPennylaneSupplierInvoice(invoiceId, config);
    if (typeof data.public_file_url !== "string" || !data.public_file_url) {
      return NextResponse.json({ error: "INVOICE_PDF_MISSING" }, { status: 404 });
    }
    const url = new URL(data.public_file_url);
    if (url.protocol !== "https:" || url.hostname !== "app.pennylane.com" ||
        !url.pathname.startsWith("/public/")) {
      return NextResponse.json({ error: "INVOICE_PDF_UNSAFE" }, { status: 502 });
    }
    // A fresh, expiring signed URL is obtained only for an authenticated PAPOT user.
    return new NextResponse(null, {
      status: 302,
      headers: { Location: url.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVOICE_PDF_FAILED";
    return NextResponse.json(
      { error: ["AUTH_REQUIRED", "MODULE_FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(code) ? code : "INVOICE_PDF_UNAVAILABLE" },
      { status: desktopRequestErrorStatus(code) ?? 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
