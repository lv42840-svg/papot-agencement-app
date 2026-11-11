import { NextResponse } from "next/server";
import { z } from "zod";
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
import {
  getQuoteItemPhoto,
  removeQuoteItemPhoto,
  setQuoteItemPhotoVisibility,
} from "@/lib/quotes/item-photos";
import { getServerFileStore } from "@/lib/server-files/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ quoteId: string; itemId: string; photoId: string }> };
const visibilitySchema = z.object({ clientVisible: z.boolean() }).strict();

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (
    code === "QUOTE_NOT_FOUND" ||
    code === "QUOTE_ITEM_NOT_FOUND" ||
    code === "QUOTE_ITEM_PHOTO_NOT_FOUND" ||
    code === "SERVER_FILE_NOT_FOUND"
  )
    return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  return 400;
}

export async function GET(_request: Request, contexte: RouteContext) {
  try {
    const { quoteId: idDevis, itemId: idElement, photoId } = await contexte.params;
    await requireModuleRequestContext("quotes", "READ");
    const contenu = await createQuotesRepository().load();
    const photo = getQuoteItemPhoto(contenu, idDevis, idElement, photoId);
    const store = getServerFileStore();
    await store.assertReady();
    const bytes = await store.readBytes(photo.storagePath, photo.sha256);
    return new Response(bytes, {
      headers: {
        "Content-Type": photo.contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`,
      },
    });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTE_ITEM_PHOTO_READ_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}

export async function PATCH(requete: Request, contexte: RouteContext) {
  try {
    const { quoteId: idDevis, itemId: idElement, photoId } = await contexte.params;
    const requestContext = await requireModuleRequestContext("quotes", "WRITE");
    const saisie = visibilitySchema.parse(await requete.json());
    const expectedRevision = expectedQuoteRevision(requete);
    const auteur = {
      userId: requestContext.user.id,
      displayName: requestContext.user.displayName,
    };
    const mutation = await createQuotesRepository().mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      return setQuoteItemPhotoVisibility(
        contenu,
        idDevis,
        idElement,
        photoId,
        saisie.clientVisible,
        auteur,
      );
    });
    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTE_ITEM_PHOTO_UPDATE_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}

export async function DELETE(requete: Request, contexte: RouteContext) {
  try {
    const { quoteId: idDevis, itemId: idElement, photoId } = await contexte.params;
    const requestContext = await requireModuleRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const expectedRevision = expectedQuoteRevision(requete);
    const courant = await repository.load();
    assertQuoteRevision(courant, idDevis, expectedRevision);
    const photo = getQuoteItemPhoto(courant, idDevis, idElement, photoId);
    const auteur = {
      userId: requestContext.user.id,
      displayName: requestContext.user.displayName,
    };
    const mutation = await repository.mutate((contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      return removeQuoteItemPhoto(contenu, idDevis, idElement, photoId, auteur);
    });
    const stillReferenced = mutation.payload.quotes.some((quote) =>
      quote.model.items.some((element) =>
        element.presentation?.photos.some((candidat) => candidat.storagePath === photo.storagePath),
      ),
    );
    if (!stillReferenced) {
      const store = getServerFileStore();
      await store.deleteFile(photo.storagePath).catch(() => false);
    }
    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTE_ITEM_PHOTO_DELETE_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
