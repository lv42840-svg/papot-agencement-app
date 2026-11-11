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
  contenu: NativeQuotesPayload,
  idDevis: string,
  idElement: string,
  requireDraft: boolean,
) {
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === idDevis);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");
  const quote = contenu.quotes[quoteIndex];
  if (requireDraft && quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  const itemIndex = quote.model.items.findIndex((element) => element.id === idElement);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");
  return { quoteIndex, quote, itemIndex, item: quote.model.items[itemIndex] };
}

function save(
  contenu: NativeQuotesPayload,
  quoteIndex: number,
  itemIndex: number,
  element: NativeQuotesPayload["quotes"][number]["model"]["items"][number],
  auteur: QuotePhotoActor,
  maintenant: Date,
): QuotePhotoMutationResult {
  const quote = contenu.quotes[quoteIndex];
  const elements = [...quote.model.items];
  elements[itemIndex] = element;
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

export function getQuoteItemPhoto(
  source: NativeQuotesPayload,
  idDevis: string,
  idElement: string,
  photoId: string,
): QuoteItemPhoto {
  const contenu = parseNativeQuotesPayload(source);
  const { item: element } = findItem(contenu, idDevis, idElement, false);
  const photo = element.presentation?.photos.find((candidat) => candidat.id === photoId);
  if (!photo) throw new Error("QUOTE_ITEM_PHOTO_NOT_FOUND");
  return photo;
}

export function registerQuoteItemPhotos(
  source: NativeQuotesPayload,
  idDevis: string,
  idElement: string,
  photos: QuoteItemPhoto[],
  auteur: QuotePhotoActor,
  maintenant: Date = new Date(),
): QuotePhotoMutationResult {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, itemIndex, item: element } = findItem(contenu, idDevis, idElement, true);
  const courant = element.presentation?.photos ?? [];
  if (courant.length + photos.length > 20) throw new Error("QUOTE_ITEM_PHOTO_LIMIT");
  const identifiants = new Set(courant.map((photo) => photo.id));
  for (const photo of photos) {
    if (identifiants.has(photo.id)) throw new Error("QUOTE_ITEM_PHOTO_DUPLICATE");
    identifiants.add(photo.id);
  }
  const updatedItem = structuredClone(element);
  updatedItem.presentation = {
    ...(updatedItem.presentation?.textStyle
      ? { textStyle: updatedItem.presentation.textStyle }
      : {}),
    photos: [...courant, ...photos],
  };
  return save(contenu, quoteIndex, itemIndex, updatedItem, auteur, maintenant);
}

export function setQuoteItemPhotoVisibility(
  source: NativeQuotesPayload,
  idDevis: string,
  idElement: string,
  photoId: string,
  clientVisible: boolean,
  auteur: QuotePhotoActor,
  maintenant: Date = new Date(),
): QuotePhotoMutationResult {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, itemIndex, item: element } = findItem(contenu, idDevis, idElement, true);
  const photos = element.presentation?.photos ?? [];
  if (!photos.some((photo) => photo.id === photoId)) throw new Error("QUOTE_ITEM_PHOTO_NOT_FOUND");
  const updatedItem = structuredClone(element);
  updatedItem.presentation = {
    ...(updatedItem.presentation?.textStyle
      ? { textStyle: updatedItem.presentation.textStyle }
      : {}),
    photos: photos.map((photo) => (photo.id === photoId ? { ...photo, clientVisible } : photo)),
  };
  return save(contenu, quoteIndex, itemIndex, updatedItem, auteur, maintenant);
}

export function removeQuoteItemPhoto(
  source: NativeQuotesPayload,
  idDevis: string,
  idElement: string,
  photoId: string,
  auteur: QuotePhotoActor,
  maintenant: Date = new Date(),
): QuotePhotoMutationResult {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, itemIndex, item: element } = findItem(contenu, idDevis, idElement, true);
  const photos = element.presentation?.photos ?? [];
  if (!photos.some((photo) => photo.id === photoId)) throw new Error("QUOTE_ITEM_PHOTO_NOT_FOUND");
  const remaining = photos.filter((photo) => photo.id !== photoId);
  const updatedItem = structuredClone(element);
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
  return save(contenu, quoteIndex, itemIndex, updatedItem, auteur, maintenant);
}
