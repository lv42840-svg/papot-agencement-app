import { z } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { loadOriginalNativeInvoicePdf } from "@/lib/billing/native-pdf-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The file is reproduced from the persisted immutable issue, not from a changed draft. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    await requireModuleRequestContext("billing", "READ");
    const { invoiceId } = await params;
    if (!z.string().uuid().safeParse(invoiceId).success) {
      return Response.json({ error: "BILLING_NATIVE_INVOICE_NOT_FOUND" }, { status: 404 });
    }
    const payload = await createBillingRepository().load();
    const invoice = payload.nativeInvoiceLedger?.invoices.find((item) => item.id === invoiceId);
    if (!invoice) {
      return Response.json({ error: "BILLING_NATIVE_INVOICE_NOT_FOUND" }, { status: 404 });
    }
    const pdf = generateNativeInvoicePdf(invoice);
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="papot-facture-' + invoice.number + '.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_NATIVE_PDF_FAILED";
    return Response.json(
      { error: code },
      {
        status: desktopRequestErrorStatus(code) ?? 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
