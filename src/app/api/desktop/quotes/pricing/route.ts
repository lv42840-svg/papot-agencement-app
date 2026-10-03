import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  applyQuotePricingMutation,
  quotePricingMutationSchema,
} from "@/lib/quotes/pricing-mutations";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(payload: NativeQuotesPayload, canWrite: boolean, focusQuoteId?: string) {
  return { payload, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (
    code === "QUOTE_NOT_FOUND" ||
    code === "QUOTE_LINE_NOT_FOUND" ||
    code === "QUOTE_OPTION_TARGET_NOT_FOUND"
  ) {
    return 404;
  }
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  return 400;
}

export async function POST(request: Request) {
  try {
    const input = quotePricingMutationSchema.parse(await request.json());
    const context = await requireDesktopRequestContext("quotes", "WRITE");
    const actor = { userId: context.user.id, displayName: context.user.displayName };
    const repository = createQuotesRepository();
    const mutation = await repository.mutate((payload) =>
      applyQuotePricingMutation(payload, input, actor),
    );

    return noStoreJson(
      publicSnapshot(mutation.payload, context.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "QUOTES_PRICING_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTES_PRICING_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}
