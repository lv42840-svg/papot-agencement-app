import { NextResponse } from "next/server";
import { ZodError } from "zod";
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
import {
  applyQuotePricingMutation,
  quotePricingMutationSchema,
} from "@/lib/quotes/pricing-mutations";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function publicSnapshot(contenu: NativeQuotesPayload, canWrite: boolean, focusQuoteId?: string) {
  return { payload: contenu, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
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

export async function POST(requete: Request) {
  try {
    const saisie = quotePricingMutationSchema.parse(await requete.json());
    const contexte = await requireModuleRequestContext("quotes", "WRITE");
    const auteur = { userId: contexte.user.id, displayName: contexte.user.displayName };
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, saisie.quoteId, expectedRevision);
      return applyQuotePricingMutation(contenu, saisie, auteur);
    });

    return noStoreJson(
      publicSnapshot(mutation.payload, contexte.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "QUOTES_PRICING_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "QUOTES_PRICING_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}
