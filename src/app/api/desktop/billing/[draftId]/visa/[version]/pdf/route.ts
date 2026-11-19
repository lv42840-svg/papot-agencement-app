import { z } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { generateBillingVisaProvisionalPdf } from "@/lib/billing/visa-provisional-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A stored provisional version only. No invoice number or Pennylane operation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ draftId: string; version: string }> },
) {
  try {
    await requireModuleRequestContext("billing", "READ");
    const { draftId, version: rawVersion } = await params;
    if (!z.string().uuid().safeParse(draftId).success || !/^[1-9]\d{0,2}$/.test(rawVersion)) {
      return Response.json({ error: "BILLING_VISA_NOT_FOUND" }, { status: 404 });
    }
    const version = Number(rawVersion);
    const payload = await createBillingRepository().load();
    const draft = payload.drafts.find((item) => item.id === draftId);
    const visa = payload.visaVersions?.find(
      (item) => item.draftId === draftId && item.version === version,
    );
    if (!draft || !visa) {
      return Response.json({ error: "BILLING_VISA_NOT_FOUND" }, { status: 404 });
    }

    const pdf = generateBillingVisaProvisionalPdf(visa, draft);
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="papot-situation-provisoire-${draftId}-v${version}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_VISA_PDF_FAILED";
    return Response.json(
      { error: code },
      {
        status: desktopRequestErrorStatus(code) ?? 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
