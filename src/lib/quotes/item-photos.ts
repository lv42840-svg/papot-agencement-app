import { parseQuoteModel, type QuoteItemPhoto } from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

type QuotePhotoActor = { userId: string; displayName: string };

type QuotePhotoMutationResult = {
  payload: NativeQuotesPayload;
  focusQuoteId: string;
};

function findItem(
  payload: NativeQuotesPayload,
  quoteId: string,
  itemId: string,
  requireDraft: boolean,
) {
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");
  const quote = payload.quotes[quoteIndex];
  if (requireDraft && quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  const itemIndex = quote.model.items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");
  return { quoteIndex, quote, itemIndex, item: quote.model.items[itemIndex] };
}

function save(
  payload: NativeQuotesPayload,
  quoteIndex: number,
  itemIndex: number,
  item: NativeQuotesPayload["quotes"][number]["model"]["items"][number],
  actor: QuotePhotoActor,
  now: Date,
): QuotePhotoMutationResult {
  const quote = payload.quotes[quoteIndex];
  const items = [...quote.model.items];
  items[itemIndex] = item;
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items }),
    updatedAt: now.toISOString(),
    updatedByName: actor.displayName,
  });
  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}

export function getQuoteItemPhoto(
  source: NativeQuotesPayload,
  quoteId: string,
  itemId: string,
  photoId: string,
): QuoteItemPhoto {
  const payload = parseNativeQuotesPayload(source);
  const { item } = findItem(payload, quoteId, itemId, false);
  const photo = item.presentation?.photos.find((candidate) => candidate.id === photoId);
  if (!photo) throw new Error("QUOTE_ITEM_PHOTO_NOT_FOUND");
  return photo;
}

export function registerQuoteItemPhotos(
  source: NativeQuotesPayload,
  quoteId: string,
  itemId: string,
  photos: QuoteItemPhoto[],
  actor: QuotePhotoActor,
  now: Date = new Date(),
): QuotePhotoMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, itemIndex, item } = findItem(payload, quoteId, itemId, true);
  const current = item.presentation?.photos ?? [];
  if (current.length + photos.length > 20) throw new Error("QUOTE_ITEM_PHOTO_LIMIT");
  const ids = new Set(current.map((photo) => photo.id));
  for (const photo of photos) {
    if (ids.has(photo.id)) throw new Error("QUOTE_ITEM_PHOTO_DUPLICATE");
    ids.add(photo.id);
  }
  const updatedItem = structuredClone(item);
  updatedItem.presentation = {
    ...(updatedItem.presentation?.textStyle
      ? { textStyle: updatedItem.presentation.textStyle }
      : {}),
    photos: [...current, ...photos],
  };
  return save(payload, quoteIndex, itemIndex, updatedItem, actor, now);
}

export function setQuoteItemPhotoVisibility(
  source: NativeQuotesPayload,
  quoteId: string,
  itemId: string,
  photoId: string,
  clientVisible: boolean,
  actor: QuotePhotoActor,
  now: Date = new Date(),
): QuotePhotoMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, itemIndex, item } = findItem(payload, quoteId, itemId, true);
  const photos = item.presentation?.photos ?? [];
  if (!photos.some((photo) => photo.id === photoId)) throw new Error("QUOTE_ITEM_PHOTO_NOT_FOUND");
  const updatedItem = structuredClone(item);
  updatedItem.presentation = {
    ...(updatedItem.presentation?.textStyle
      ? { textStyle: updatedItem.presentation.textStyle }
      : {}),
    photos: photos.map((photo) => (photo.id === photoId ? { ...photo, clientVisible } : photo)),
  };
  return save(payload, quoteIndex, itemIndex, updatedItem, actor, now);
}

export function removeQuoteItemPhoto(
  source: NativeQuotesPayload,
  quoteId: string,
  itemId: string,
  photoId: string,
  actor: QuotePhotoActor,
  now: Date = new Date(),
): QuotePhotoMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, itemIndex, item } = findItem(payload, quoteId, itemId, true);
  const photos = item.presentation?.photos ?? [];
  if (!photos.some((photo) => photo.id === photoId)) throw new Error("QUOTE_ITEM_PHOTO_NOT_FOUND");
  const remaining = photos.filter((photo) => photo.id !== photoId);
  const updatedItem = structuredClone(item);
  if (remaining.length === 0 && !updatedItem.presentation?.textStyle) {
    delete updatedItem.presentation;
  } else {
    updatedItem.presentation = {
      ...(updatedItem.presentation?.textStyle
        ? { textStyle: updatedItem.presentation.textStyle }
        : {}),
      photos: remaining,
    };
  }
  return save(payload, quoteIndex, itemIndex, updatedItem, actor, now);
}
