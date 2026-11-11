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
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (code === "QUOTE_NOT_FOUND" || code === "QUOTE_ITEM_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  return 400;
}

export async function POST(requete: Request, contexte: RouteContext) {
  try {
    const { quoteId: idDevis, itemId: idElement } = await contexte.params;
    const requestContext = await requireModuleRequestContext("quotes", "WRITE");
    const corps = requestSchema.parse(await requete.json());
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const auteur = {
      userId: requestContext.user.id,
      displayName: requestContext.user.displayName,
    };
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      return {
        payload: applyQuoteRichTextUpdate(
          contenu,
          { quoteId: idDevis, itemId: idElement, ...corps },
          auteur,
        ),
        focusQuoteId: idDevis,
      };
    });

    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTE_RICH_TEXT_SAVE_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
