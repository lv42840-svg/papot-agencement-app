import { NextResponse } from "next/server";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import {
  assertQuoteRevision,
  expectedQuoteRevision,
  quoteConcurrencyStatus,
} from "@/lib/quotes/concurrency";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { registerQuoteItemPhotos } from "@/lib/quotes/item-photos";
import { cleanupQuoteItemPhotos, uploadQuoteItemPhotos } from "@/lib/quotes/item-photo-storage";
import { getServerFileStore } from "@/lib/server-files/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ quoteId: string; itemId: string }> };

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (code === "QUOTE_NOT_FOUND" || code === "QUOTE_ITEM_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  if (code === "QUOTE_ITEM_PHOTO_TOO_LARGE" || code === "QUOTE_ITEM_PHOTO_LIMIT") return 413;
  if (code === "QUOTE_ITEM_PHOTO_TYPE_INVALID") return 415;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  return 400;
}

export async function POST(requete: Request, contexte: RouteContext) {
  let uploaded: Awaited<ReturnType<typeof uploadQuoteItemPhotos>> = [];
  let store: ReturnType<typeof getServerFileStore> | undefined;
  try {
    const { quoteId: idDevis, itemId: idElement } = await contexte.params;
    const requestContext = await requireModuleRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const courant = await repository.load();
    const quote = assertQuoteRevision(courant, idDevis, expectedRevision);
    if (!quote) throw new Error("QUOTE_NOT_FOUND");
    if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
    const element = quote.model.items.find((candidat) => candidat.id === idElement);
    if (!element) throw new Error("QUOTE_ITEM_NOT_FOUND");

    const form = await requete.formData();
    const fichiers = form
      .getAll("files")
      .filter((valeur): valeur is File => valeur instanceof File);
    if ((element.presentation?.photos.length ?? 0) + fichiers.length > 20) {
      throw new Error("QUOTE_ITEM_PHOTO_LIMIT");
    }

    store = getServerFileStore();
    await store.assertReady();
    uploaded = await uploadQuoteItemPhotos(store, {
      quoteId: idDevis,
      itemId: idElement,
      files: fichiers,
      uploadedByName: requestContext.user.displayName,
    });
    const auteur = {
      userId: requestContext.user.id,
      displayName: requestContext.user.displayName,
    };
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      return registerQuoteItemPhotos(contenu, idDevis, idElement, uploaded, auteur);
    });
    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    if (store && uploaded.length > 0) await cleanupQuoteItemPhotos(store, uploaded);
    const code = erreur instanceof Error ? erreur.message : "QUOTE_ITEM_PHOTO_UPLOAD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
