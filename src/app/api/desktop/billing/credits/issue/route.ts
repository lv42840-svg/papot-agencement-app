import { z } from "zod";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import { requireModuleRequestContext, desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { issueNativeCreditNote, issueNativeCreditNoteInputSchema } from "@/lib/billing/native-credit-notes";
import { generateNativeCreditNotePdf } from "@/lib/billing/native-credit-pdf";
import { loadOriginalNativeInvoicePdf, storeOriginalNativeInvoicePdf } from "@/lib/billing/native-pdf-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Independent, disabled-by-default legal credit-note issuance. No Pennylane write. */
export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("billing", "WRITE");
    await requireSpecialPermission(context.user, "billing.issue_credit_notes");
    if (
      process.env.PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED !== "true" ||
      process.env.PAPOT_NATIVE_CREDIT_NOTES_ENABLED !== "true"
    ) {
      return Response.json({ error: "BILLING_NATIVE_CREDIT_ISSUANCE_DISABLED" }, {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const input = issueNativeCreditNoteInputSchema.parse(await request.json());
    const repository = createBillingRepository();
    const payload = await repository.mutate(async (current) => {
      const wasIssued = current.nativeCreditNoteLedger?.creditNotes.some(
        (note) => note.requestId === input.requestId,
      ) ?? false;
      const next = issueNativeCreditNote(current, input, context.user.displayName);
      const note = next.nativeCreditNoteLedger?.creditNotes.find(
        (item) => item.requestId === input.requestId,
      );
      if (!note) throw new Error("BILLING_NATIVE_CREDIT_ISSUE_NOT_PERSISTED");
      const original = next.nativeInvoiceLedger?.invoices.find(
        (item) => item.id === note.originalInvoiceId,
      );
      if (!original) throw new Error("BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND");
      if (wasIssued) {
        // Never rebuild an issued PDF on retry: return the archived historical bytes.
        await loadOriginalNativeInvoicePdf(note);
        return next;
      }
      const pdf = generateNativeCreditNotePdf(note, original);
      // The new legal number, credit record and PDF archive are committed together.
      // A failure here rolls back ALL three.
      await storeOriginalNativeInvoicePdf(note, pdf);
      return next;
    });
    const note = payload.nativeCreditNoteLedger?.creditNotes.find(
      (item) => item.requestId === input.requestId,
    );
    if (!note) throw new Error("BILLING_NATIVE_CREDIT_ISSUE_NOT_PERSISTED");
    return Response.json({
      issued: {
        id: note.id,
        originalInvoiceId: note.originalInvoiceId,
        number: note.number,
        issuedOn: note.issuedOn,
        totalTtcCents: note.totalTtcCents,
        reason: note.reason,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof z.ZodError
      ? "BILLING_NATIVE_CREDIT_REQUEST_INVALID"
      : error instanceof Error ? error.message : "BILLING_NATIVE_CREDIT_ISSUE_FAILED";
    const status = desktopRequestErrorStatus(code) ??
      (code === "BILLING_NATIVE_CREDIT_REQUEST_INVALID" ? 400
        : code === "BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND" ? 404
        : code.startsWith("BILLING_NATIVE_CREDIT_") ||
          code === "BILLING_NATIVE_SEQUENCE_CORRUPT"
          ? 409 : 500);
    return Response.json({ error: code }, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
