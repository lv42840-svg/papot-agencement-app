import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireDesktopRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { quoteId, itemId, photoId } = await context.params;
    await requireDesktopRequestContext("quotes", "READ");
    const payload = await createQuotesRepository().load();
    const photo = getQuoteItemPhoto(payload, quoteId, itemId, photoId);
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
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_ITEM_PHOTO_READ_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { quoteId, itemId, photoId } = await context.params;
    const requestContext = await requireDesktopRequestContext("quotes", "WRITE");
    const input = visibilitySchema.parse(await request.json());
    const actor = {
      userId: requestContext.owner.userId,
      displayName: requestContext.owner.displayName,
    };
    const mutation = await createQuotesRepository().mutate((payload) =>
      setQuoteItemPhotoVisibility(payload, quoteId, itemId, photoId, input.clientVisible, actor),
    );
    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_ITEM_PHOTO_UPDATE_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { quoteId, itemId, photoId } = await context.params;
    const requestContext = await requireDesktopRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const current = await repository.load();
    const photo = getQuoteItemPhoto(current, quoteId, itemId, photoId);
    const actor = {
      userId: requestContext.owner.userId,
      displayName: requestContext.owner.displayName,
    };
    const mutation = await repository.mutate((payload) =>
      removeQuoteItemPhoto(payload, quoteId, itemId, photoId, actor),
    );
    const stillReferenced = mutation.payload.quotes.some((quote) =>
      quote.model.items.some((item) =>
        item.presentation?.photos.some((candidate) => candidate.storagePath === photo.storagePath),
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
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_ITEM_PHOTO_DELETE_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
