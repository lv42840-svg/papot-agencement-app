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
  quoteInternalNotesSchema,
  updateDraftQuoteInternalNotes,
} from "@/lib/quotes/internal-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (code === "QUOTE_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  return 400;
}

export async function PATCH(
  requete: Request,
  { params: parametres }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const { quoteId: idDevis } = await parametres;
    const saisie = quoteInternalNotesSchema.parse(await requete.json());
    const contexte = await requireModuleRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      return updateDraftQuoteInternalNotes(contenu, idDevis, saisie, {
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
        ? "QUOTE_INTERNAL_NOTES_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "QUOTE_INTERNAL_NOTES_UPDATE_FAILED";
    return NextResponse.json({ error: code }, { status: errorStatus(code) });
  }
}
