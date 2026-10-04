import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import {
  assertQuoteRevision,
  expectedQuoteRevision,
  quoteConcurrencyStatus,
} from "@/lib/quotes/concurrency";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { createQuoteVariant, createQuoteVersion, duplicateQuote } from "@/lib/quotes/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ quoteId: string }> };

const lifecycleSchema = z
  .object({
    action: z.enum(["createVersion", "createVariant", "duplicateQuote"]),
  })
  .strict();

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (code === "QUOTE_NOT_FOUND") return 404;
  if (
    code === "QUOTE_VERSION_SOURCE_OUTDATED" ||
    code === "QUOTE_VERSION_SOURCE_CLOSED" ||
    code === "QUOTE_VARIANT_NAME_UNAVAILABLE"
  ) {
    return 409;
  }
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { quoteId } = await context.params;
    const requestContext = await requireModuleRequestContext("quotes", "WRITE");
    const input = lifecycleSchema.parse(await request.json());
    const actor = {
      userId: requestContext.user.id,
      displayName: requestContext.user.displayName,
    };
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(request);
    const mutation = await repository.mutate((payload) => {
      assertQuoteRevision(payload, quoteId, expectedRevision);
      if (input.action === "createVersion") return createQuoteVersion(payload, quoteId, actor);
      if (input.action === "createVariant") return createQuoteVariant(payload, quoteId, actor);
      return duplicateQuote(payload, quoteId, actor);
    });
    return NextResponse.json(
      { payload: mutation.payload, focusQuoteId: mutation.focusQuoteId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_LIFECYCLE_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
