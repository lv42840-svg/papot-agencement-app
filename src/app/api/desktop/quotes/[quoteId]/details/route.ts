import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  quoteGeneralDetailsSchema,
  updateDraftQuoteGeneralDetails,
} from "@/lib/quotes/general-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const { quoteId } = await params;
    const details = quoteGeneralDetailsSchema.parse(await request.json());
    const context = await requireDesktopRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const mutation = await repository.mutate((payload) =>
      updateDraftQuoteGeneralDetails(payload, quoteId, details, {
        displayName: context.user.displayName,
      }),
    );
    const response = NextResponse.json({
      payload: mutation.payload,
      canWrite: context.moduleAccess.canWrite,
      focusQuoteId: mutation.focusQuoteId,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "QUOTE_DETAILS_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTE_DETAILS_UPDATE_FAILED";
    const status =
      code === "QUOTE_NOT_FOUND"
        ? 404
        : code === "QUOTE_NOT_EDITABLE" || code === "QUOTE_VARIANT_VERSION_CONFLICT"
          ? 409
          : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
