import { NextResponse } from "next/server";
import {
  requireDesktopRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
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
  if (code === "QUOTE_NOT_FOUND" || code === "QUOTE_ITEM_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE") return 409;
  if (code === "QUOTE_ITEM_PHOTO_TOO_LARGE" || code === "QUOTE_ITEM_PHOTO_LIMIT") return 413;
  if (code === "QUOTE_ITEM_PHOTO_TYPE_INVALID") return 415;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  let uploaded: Awaited<ReturnType<typeof uploadQuoteItemPhotos>> = [];
  let store: ReturnType<typeof getServerFileStore> | undefined;
  try {
    const { quoteId, itemId } = await context.params;
    const requestContext = await requireDesktopRequestContext("quotes", "WRITE");
    const repository = createQuotesRepository();
    const current = await repository.load();
    const quote = current.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote) throw new Error("QUOTE_NOT_FOUND");
    if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
    const item = quote.model.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("QUOTE_ITEM_NOT_FOUND");

    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if ((item.presentation?.photos.length ?? 0) + files.length > 20) {
      throw new Error("QUOTE_ITEM_PHOTO_LIMIT");
    }

    store = getServerFileStore();
    await store.assertReady();
    uploaded = await uploadQuoteItemPhotos(store, {
      quoteId,
      itemId,
      files,
      uploadedByName: requestContext.owner.displayName,
    });
    const actor = {
      userId: requestContext.owner.userId,
      displayName: requestContext.owner.displayName,
    };
    const mutation = await repository.mutate((payload) =>
      registerQuoteItemPhotos(payload, quoteId, itemId, uploaded, actor),
    );
    return NextResponse.json(
      { payload: mutation.payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (store && uploaded.length > 0) await cleanupQuoteItemPhotos(store, uploaded);
    const code = error instanceof Error ? error.message : "QUOTE_ITEM_PHOTO_UPLOAD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
