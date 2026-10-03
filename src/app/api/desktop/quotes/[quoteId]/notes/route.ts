import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  quoteInternalNotesSchema,
  updateDraftQuoteInternalNotes,
} from "@/lib/quotes/internal-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "QUOTE_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  return 400;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const { quoteId } = await params;
    const input = quoteInternalNotesSchema.parse(await request.json());
    const context = await requireDesktopRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const mutation = await repository.mutate((payload) =>
      updateDraftQuoteInternalNotes(payload, quoteId, input, {
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
        ? "QUOTE_INTERNAL_NOTES_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTE_INTERNAL_NOTES_UPDATE_FAILED";
    return NextResponse.json({ error: code }, { status: errorStatus(code) });
  }
}
