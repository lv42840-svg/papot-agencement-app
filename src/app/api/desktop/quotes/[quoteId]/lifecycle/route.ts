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

export async function POST(requete: Request, contexte: RouteContext) {
  try {
    const { quoteId: idDevis } = await contexte.params;
    const requestContext = await requireModuleRequestContext("quotes", "WRITE");
    const saisie = lifecycleSchema.parse(await requete.json());
    const auteur = {
      userId: requestContext.user.id,
      displayName: requestContext.user.displayName,
    };
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      if (saisie.action === "createVersion") return createQuoteVersion(contenu, idDevis, auteur);
      if (saisie.action === "createVariant") return createQuoteVariant(contenu, idDevis, auteur);
      return duplicateQuote(contenu, idDevis, auteur);
    });
    return NextResponse.json(
      { payload: mutation.payload, focusQuoteId: mutation.focusQuoteId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTE_LIFECYCLE_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
