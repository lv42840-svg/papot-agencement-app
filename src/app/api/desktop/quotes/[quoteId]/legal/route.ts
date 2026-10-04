import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";
import {
  assertQuoteRevision,
  expectedQuoteRevision,
  quoteConcurrencyStatus,
} from "@/lib/quotes/concurrency";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  applyQuoteLegalDetailsMutation,
  quoteLegalDetailsMutationSchema,
} from "@/lib/quotes/legal-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const { quoteId } = await params;
    const input = quoteLegalDetailsMutationSchema.parse(await request.json());
    const context = await requireModuleRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(request);
    const mutation = await repository.mutate((payload) => {
      assertQuoteRevision(payload, quoteId, expectedRevision);
      return applyQuoteLegalDetailsMutation(payload, quoteId, input, {
        displayName: context.user.displayName,
      });
    });
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
        ? "QUOTE_LEGAL_DETAILS_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTE_LEGAL_DETAILS_UPDATE_FAILED";
    const concurrencyStatus = quoteConcurrencyStatus(code);
    const status =
      concurrencyStatus ??
      (code === "QUOTE_NOT_FOUND" || code === "QUOTE_LINE_NOT_FOUND"
        ? 404
        : code === "QUOTE_NOT_EDITABLE"
          ? 409
          : 400);
    return NextResponse.json({ error: code }, { status });
  }
}
