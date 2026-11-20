import { z } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { loadOriginalNativeInvoicePdf } from "@/lib/billing/native-pdf-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve immutable official credit PDF bytes, never a freshly regenerated version. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ creditId: string }> },
) {
  try {
    await requireModuleRequestContext("billing", "READ");
    const { creditId } = await params;
    if (!z.string().uuid().safeParse(creditId).success) {
      return Response.json({ error: "BILLING_NATIVE_CREDIT_NOT_FOUND" }, { status: 404 });
    }
    const payload = await createBillingRepository().load();
    const note = payload.nativeCreditNoteLedger?.creditNotes.find((item) => item.id === creditId);
    if (!note) {
      return Response.json({ error: "BILLING_NATIVE_CREDIT_NOT_FOUND" }, { status: 404 });
    }
    const archived = await loadOriginalNativeInvoicePdf(note);
    return new Response(Buffer.from(archived.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="papot-avoir-' + note.number + '.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_NATIVE_CREDIT_PDF_FAILED";
    return Response.json(
      { error: code },
      {
        status: desktopRequestErrorStatus(code) ?? 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
