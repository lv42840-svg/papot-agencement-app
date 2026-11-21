import { z } from "zod";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import { desktopRequestErrorStatus, requireModuleRequestContext } from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { findBillingTestDocument } from "@/lib/billing/test-sandbox";
import { generateNativeInvoicePdf } from "@/lib/billing/native-invoice-pdf";
import { generateNativeCreditNotePdf } from "@/lib/billing/native-credit-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Simulation documents are regenerated and watermarked; never part of legal archives. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const context = await requireModuleRequestContext("billing", "WRITE");
    await requireSpecialPermission(context.user, "billing.test_sandbox");
    if (process.env.PAPOT_BILLING_TEST_SANDBOX_ENABLED !== "true") {
      return Response.json({ error: "BILLING_TEST_SANDBOX_DISABLED" }, { status: 403 });
    }
    const { documentId } = await params;
    if (!z.string().uuid().safeParse(documentId).success) {
      return Response.json({ error: "BILLING_TEST_DOCUMENT_NOT_FOUND" }, { status: 404 });
    }
    const payload = await createBillingRepository().load();
    const found = findBillingTestDocument(payload, documentId);
    const pdf = found.kind === "INVOICE"
      ? generateNativeInvoicePdf(found.invoice, { testOnly: true })
      : generateNativeCreditNotePdf(found.credit, found.original, { testOnly: true });
    const number = found.kind === "INVOICE" ? found.invoice.number : found.credit.number;
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="PAPOT-TEST-' + number + '.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_TEST_DOCUMENT_ERROR";
    return Response.json({ error: code }, {
      status: code === "BILLING_TEST_DOCUMENT_NOT_FOUND" ? 404 :
        desktopRequestErrorStatus(code) ?? 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
