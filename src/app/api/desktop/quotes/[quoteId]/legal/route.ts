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
  requete: Request,
  { params: parametres }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const { quoteId: idDevis } = await parametres;
    const saisie = quoteLegalDetailsMutationSchema.parse(await requete.json());
    const contexte = await requireModuleRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      return applyQuoteLegalDetailsMutation(contenu, idDevis, saisie, {
        displayName: contexte.user.displayName,
      });
    });
    const reponse = NextResponse.json({
      payload: mutation.payload,
      canWrite: contexte.moduleAccess.canWrite,
      focusQuoteId: mutation.focusQuoteId,
    });
    reponse.headers.set("Cache-Control", "no-store");
    return reponse;
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "QUOTE_LEGAL_DETAILS_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "QUOTE_LEGAL_DETAILS_UPDATE_FAILED";
    const concurrencyStatus = quoteConcurrencyStatus(code);
    const statut =
      concurrencyStatus ??
      (code === "QUOTE_NOT_FOUND" || code === "QUOTE_LINE_NOT_FOUND"
        ? 404
        : code === "QUOTE_NOT_EDITABLE"
          ? 409
          : 400);
    return NextResponse.json({ error: code }, { status: statut });
  }
}
