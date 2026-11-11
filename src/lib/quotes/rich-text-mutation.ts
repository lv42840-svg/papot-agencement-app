import { parseQuoteModel, quoteRichTextSchema, type QuoteItem, type QuoteRichText } from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";
import { quoteRichTextToPlainText } from "./rich-text";

export type QuoteRichTextActor = {
  userId: string;
  displayName: string;
};

export type QuoteRichTextUpdate = {
  quoteId: string;
  itemId: string;
  text: string;
  richText: QuoteRichText;
};

function itemText(element: QuoteItem): string | null {
  if (element.kind === "SECTION" || element.kind === "SUBSECTION") return element.title;
  if (element.kind === "LINE") return element.description;
  return null;
}

function normalizeLineEndings(valeur: string): string {
  return valeur.replace(/\r\n?/g, "\n");
}

function normalizeRichTextLineEndings(richText: QuoteRichText): QuoteRichText {
  return {
    runs: richText.runs.map((run) => ({
      ...run,
      text: normalizeLineEndings(run.text),
    })),
  };
}

function withUpdatedText(element: QuoteItem, texte: string, richText: QuoteRichText): QuoteItem {
  const presentation = {
    ...(element.presentation ?? {}),
    richText,
    photos: element.presentation?.photos ?? [],
  };

  if (element.kind === "SECTION" || element.kind === "SUBSECTION") {
    return { ...element, title: texte, presentation };
  }
  if (element.kind === "LINE") {
    return { ...element, description: texte, presentation };
  }
  throw new Error("QUOTE_RICH_TEXT_ITEM_UNSUPPORTED");
}

export function applyQuoteRichTextUpdate(
  source: NativeQuotesPayload,
  saisie: QuoteRichTextUpdate,
  auteur: QuoteRichTextActor,
  maintenant: Date = new Date(),
): NativeQuotesPayload {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === saisie.quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const itemIndex = quote.model.items.findIndex((element) => element.id === saisie.itemId);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");
  const element = quote.model.items[itemIndex];
  if (itemText(element) === null) {
    throw new Error("QUOTE_RICH_TEXT_ITEM_UNSUPPORTED");
  }

  const texte = normalizeLineEndings(saisie.text).trim();
  const maxLength = element.kind === "LINE" ? 4000 : 500;
  if (!texte || texte.length > maxLength) {
    throw new Error("QUOTE_RICH_TEXT_INVALID");
  }

  const richText = normalizeRichTextLineEndings(quoteRichTextSchema.parse(saisie.richText));
  if (quoteRichTextToPlainText(richText).trim() !== texte) {
    throw new Error("QUOTE_RICH_TEXT_TEXT_MISMATCH");
  }

  const elements = [...quote.model.items];
  elements[itemIndex] = withUpdatedText(element, texte, richText);
  const timestamp = maintenant.toISOString();
  contenu.quotes[quoteIndex] = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });

  return parseNativeQuotesPayload(contenu);
}
