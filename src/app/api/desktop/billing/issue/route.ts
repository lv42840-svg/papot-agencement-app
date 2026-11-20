import { z } from "zod";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { issueNativeInvoice, issueNativeInvoiceInputSchema } from "@/lib/billing/native-issuance";
import { generateNativeInvoicePdf } from "@/lib/billing/native-invoice-pdf";
import { storeOriginalNativeInvoicePdf } from "@/lib/billing/native-pdf-archive";
import { createCompanyProfileRepository } from "@/lib/company-profile/create-repository";
import { createClientsRepository } from "@/lib/clients/create-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No issuance endpoint is reachable without an explicit rollout and a dedicated permission. */
export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("billing", "WRITE");
    await requireSpecialPermission(context.user, "billing.issue_invoices");
    if (process.env.PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED !== "true") {
      return Response.json(
        { error: "BILLING_NATIVE_ISSUANCE_DISABLED" },
        {
          status: 403,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
    const input = issueNativeInvoiceInputSchema.parse(await request.json());
    const [company, clients] = await Promise.all([
      createCompanyProfileRepository().load(),
      (await createClientsRepository()).load(),
    ]);
    const repository = createBillingRepository();
    const payload = await repository.mutate(async (current) => {
      const draft = current.drafts.find((item) => item.id === input.draftId);
      if (!draft) throw new Error("BILLING_DRAFT_NOT_FOUND");
      const client = clients.clients.find((item) => item.id === draft.clientId);
      if (!client) throw new Error("BILLING_NATIVE_BUYER_PROFILE_INCOMPLETE");
      const next = issueNativeInvoice(current, input, company, client, context.user.displayName);
      const issued = next.nativeInvoiceLedger?.invoices.find(
        (item) => item.requestId === input.requestId,
      );
      if (!issued) throw new Error("BILLING_NATIVE_ISSUE_NOT_PERSISTED");
      // Original PDF and invoice number are committed by ONE transaction.
      // On any archive failure, both PDF and the numbered invoice roll back.
      const pdf = generateNativeInvoicePdf(issued);
      await storeOriginalNativeInvoicePdf(issued, pdf);
      return next;
    });
    const invoice = payload.nativeInvoiceLedger?.invoices.find(
      (item) => item.requestId === input.requestId,
    );
    if (!invoice) throw new Error("BILLING_NATIVE_ISSUE_NOT_PERSISTED");
    return Response.json(
      {
        issued: {
          id: invoice.id,
          number: invoice.number,
          draftId: invoice.draftId,
          issuedAt: invoice.issuedAt,
        },
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "BILLING_NATIVE_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "BILLING_NATIVE_ISSUE_FAILED";
    const status =
      desktopRequestErrorStatus(code) ??
      (code === "BILLING_NATIVE_REQUEST_INVALID"
        ? 400
        : code === "BILLING_DRAFT_NOT_FOUND"
          ? 404
          : code.startsWith("BILLING_NATIVE_") ||
              code === "BILLING_VERSION_CONFLICT" ||
              code === "BILLING_APPROVAL_TOTALS_MISMATCH"
            ? 409
            : 500);
    return Response.json(
      { error: code },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
