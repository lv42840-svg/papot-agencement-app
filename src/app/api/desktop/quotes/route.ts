import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { applyQuotesMutation, quotesMutationSchema } from "@/lib/quotes/mutations";
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
  if (code === "QUOTE_AFFAIR_NOT_FOUND" || code === "QUOTE_CLIENT_NOT_FOUND") return 404;
  if (code === "QUOTE_AFFAIR_CLOSED" || code === "QUOTE_CLIENT_ARCHIVED") return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("quotes", "READ");
    const payload = await createQuotesRepository().load();
    return noStoreJson(publicSnapshot(payload, context.moduleAccess.canWrite));
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTES_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  try {
    const input = quotesMutationSchema.parse(await request.json());
    const context = await requireDesktopRequestContext("quotes", "WRITE");
    const commercialRepository = createCommercialRepository(context);
    const clientsRepository = await createClientsRepository(context);
    const [commercial, clients] = await Promise.all([
      commercialRepository.load(),
      clientsRepository.load(),
    ]);

    const affair = commercial.cases.find((item) => item.id === input.commercialCaseId);
    if (!affair) throw new Error("QUOTE_AFFAIR_NOT_FOUND");
    if (isCommercialClosed(affair)) throw new Error("QUOTE_AFFAIR_CLOSED");
    if (!affair.clientId) throw new Error("QUOTE_CLIENT_NOT_FOUND");

    const client = clients.clients.find((item) => item.id === affair.clientId);
    if (!client) throw new Error("QUOTE_CLIENT_NOT_FOUND");
    if (client.isArchived) throw new Error("QUOTE_CLIENT_ARCHIVED");

    const repository = createQuotesRepository();
    const mutation = await repository.mutate((payload) =>
      applyQuotesMutation(
        payload,
        input,
        { userId: context.user.id, displayName: context.user.displayName },
        client.id,
      ),
    );

    return noStoreJson(
      publicSnapshot(mutation.payload, context.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "QUOTES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTES_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}
