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

function itemText(item: QuoteItem): string | null {
  if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.title;
  if (item.kind === "LINE") return item.description;
  return null;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeRichTextLineEndings(richText: QuoteRichText): QuoteRichText {
  return {
    runs: richText.runs.map((run) => ({
      ...run,
      text: normalizeLineEndings(run.text),
    })),
  };
}

function withUpdatedText(item: QuoteItem, text: string, richText: QuoteRichText): QuoteItem {
  const presentation = {
    ...(item.presentation ?? {}),
    richText,
    photos: item.presentation?.photos ?? [],
  };

  if (item.kind === "SECTION" || item.kind === "SUBSECTION") {
    return { ...item, title: text, presentation };
  }
  if (item.kind === "LINE") {
    return { ...item, description: text, presentation };
  }
  throw new Error("QUOTE_RICH_TEXT_ITEM_UNSUPPORTED");
}

export function applyQuoteRichTextUpdate(
  source: NativeQuotesPayload,
  input: QuoteRichTextUpdate,
  actor: QuoteRichTextActor,
  now: Date = new Date(),
): NativeQuotesPayload {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === input.quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const itemIndex = quote.model.items.findIndex((item) => item.id === input.itemId);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");
  const item = quote.model.items[itemIndex];
  if (itemText(item) === null) {
    throw new Error("QUOTE_RICH_TEXT_ITEM_UNSUPPORTED");
  }

  const text = normalizeLineEndings(input.text).trim();
  const maxLength = item.kind === "LINE" ? 4000 : 500;
  if (!text || text.length > maxLength) {
    throw new Error("QUOTE_RICH_TEXT_INVALID");
  }

  const richText = normalizeRichTextLineEndings(quoteRichTextSchema.parse(input.richText));
  if (quoteRichTextToPlainText(richText).trim() !== text) {
    throw new Error("QUOTE_RICH_TEXT_TEXT_MISMATCH");
  }

  const items = [...quote.model.items];
  items[itemIndex] = withUpdatedText(item, text, richText);
  const timestamp = now.toISOString();
  payload.quotes[quoteIndex] = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items }),
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });

  return parseNativeQuotesPayload(payload);
}
