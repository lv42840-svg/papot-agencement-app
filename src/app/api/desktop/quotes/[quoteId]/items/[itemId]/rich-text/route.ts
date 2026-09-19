import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { quoteRichTextSchema } from "@/lib/quotes/model";
import { applyQuoteRichTextUpdate } from "@/lib/quotes/rich-text-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ quoteId: string; itemId: string }> };

const requestSchema = z.object({
  text: z.string().max(4000),
  richText: quoteRichTextSchema,
});

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "QUOTE_NOT_FOUND" || code === "QUOTE_ITEM_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { quoteId, itemId } = await context.params;
    const requestContext = await requireDesktopRequestContext("quotes", "WRITE");
    const body = requestSchema.parse(await request.json());
    const repository = createQuotesRepository();
    const actor = {
      userId: requestContext.owner.userId,
      displayName: requestContext.owner.displayName,
    };
    const mutation = await repository.mutate((payload) => ({
      payload: applyQuoteRichTextUpdate(payload, { quoteId, itemId, ...body }, actor),
      focusQuoteId: quoteId,
    }));

    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_RICH_TEXT_SAVE_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
