import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { applyCommercialMutation } from "@/lib/commercial/mutations";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { markNativeQuoteSent } from "@/lib/quotes/send";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sendQuoteSchema = z.object({
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(payload: NativeQuotesPayload, canWrite: boolean, focusQuoteId: string) {
  return { payload, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "QUOTE_NOT_FOUND" || code === "COMMERCIAL_CASE_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE" || code === "COMMERCIAL_CASE_CLOSED") return 409;
  return 400;
}

export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const { quoteId } = await params;
    const input = sendQuoteSchema.parse(await request.json());
    const quoteContext = await requireDesktopRequestContext("quotes", "WRITE");
    const commercialContext = await requireDesktopRequestContext("commercial", "WRITE");
    const actor = {
      userId: quoteContext.user.id,
      displayName: quoteContext.user.displayName,
    };
    const now = new Date();
    const quotesRepository = createQuotesRepository();
    const commercialRepository = createCommercialRepository(commercialContext);

    const mutation = await quotesRepository.mutate(async (payload) => {
      const sent = markNativeQuoteSent(payload, quoteId, input.followUpDate, actor, now);

      await commercialRepository.mutate((commercialPayload) =>
        applyCommercialMutation(
          commercialPayload,
          {
            action: "markQuoteSent",
            caseId: sent.commercialCaseId,
            followUpDate: input.followUpDate,
          },
          actor,
          now,
        ),
      );

      return {
        payload: sent.payload,
        focusQuoteId: sent.focusQuoteId,
      };
    });

    return noStoreJson(
      publicSnapshot(mutation.payload, quoteContext.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "QUOTE_FOLLOW_UP_DATE_REQUIRED"
        : error instanceof Error
          ? error.message
          : "QUOTE_SEND_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}
