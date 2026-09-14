import { QUOTE_DEFAULT_VALIDITY_DAYS, parseQuoteQuantityInput } from "./domain";
import {
  parseQuoteModel,
  type QuoteComment,
  type QuoteItem,
  type QuoteLine,
  type QuoteModel,
  type QuoteSection,
  type QuoteSubsection,
} from "./model";

export function createQuoteDraft(params: {
  id: string;
  clientId: string;
  issueDate: string;
  paymentTerms?: string;
  subject?: string;
}): QuoteModel {
  return parseQuoteModel({
    id: params.id,
    clientId: params.clientId,
    subject: params.subject?.trim() || "Nouveau devis",
    issueDate: params.issueDate,
    validityDays: QUOTE_DEFAULT_VALIDITY_DAYS,
    paymentTerms: params.paymentTerms?.trim() || "À définir",
    items: [],
  });
}

function appendItem(quote: QuoteModel, item: QuoteItem): QuoteModel {
  return parseQuoteModel({ ...quote, items: [...quote.items, item] });
}

export function appendQuoteSection(
  quote: QuoteModel,
  params: { id: string; title?: string },
): QuoteModel {
  const section: QuoteSection = {
    id: params.id,
    kind: "SECTION",
    parentId: null,
    title: params.title?.trim() || "Nouvelle section",
  };
  return appendItem(quote, section);
}

export function appendQuoteSubsection(
  quote: QuoteModel,
  params: { id: string; parentId: string; title?: string },
): QuoteModel {
  const subsection: QuoteSubsection = {
    id: params.id,
    kind: "SUBSECTION",
    parentId: params.parentId,
    title: params.title?.trim() || "Nouvelle sous-section",
  };
  return appendItem(quote, subsection);
}

export function appendFreeQuoteLine(
  quote: QuoteModel,
  params: {
    id: string;
    parentId?: string | null;
    description?: string;
    unit?: string;
    quantityInput?: string;
    unitPriceCents?: number;
  },
): QuoteModel {
  const quantity = parseQuoteQuantityInput(params.quantityInput ?? "1");
  const line: QuoteLine = {
    id: params.id,
    kind: "LINE",
    parentId: params.parentId ?? null,
    description: params.description?.trim() || "Nouvelle ligne",
    unit: params.unit ?? "u",
    quantity: quantity.quantity,
    quantityFormula: quantity.formula,
    unitPriceCents: params.unitPriceCents ?? 0,
  };
  return appendItem(quote, line);
}

export function appendQuoteComment(
  quote: QuoteModel,
  params: { id: string; parentId?: string | null; text?: string },
): QuoteModel {
  const comment: QuoteComment = {
    id: params.id,
    kind: "COMMENT",
    parentId: params.parentId ?? null,
    text: params.text?.trim() || "Nouveau commentaire",
  };
  return appendItem(quote, comment);
}

export function replaceQuoteItem(quote: QuoteModel, item: QuoteItem): QuoteModel {
  let found = false;
  const items = quote.items.map((candidate) => {
    if (candidate.id !== item.id) return candidate;
    found = true;
    return item;
  });
  if (!found) throw new Error("QUOTE_ITEM_NOT_FOUND");
  return parseQuoteModel({ ...quote, items });
}

export function removeQuoteItemTree(quote: QuoteModel, itemId: string): QuoteModel {
  if (!quote.items.some((item) => item.id === itemId)) throw new Error("QUOTE_ITEM_NOT_FOUND");

  const removed = new Set<string>([itemId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of quote.items) {
      if (item.kind === "SECTION") continue;
      if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
        removed.add(item.id);
        changed = true;
      }
    }
  }

  return parseQuoteModel({
    ...quote,
    items: quote.items.filter((item) => !removed.has(item.id)),
  });
}

export function updateQuoteLineQuantityInput(
  quote: QuoteModel,
  lineId: string,
  quantityInput: string,
): QuoteModel {
  const item = quote.items.find((candidate) => candidate.id === lineId);
  if (!item || item.kind !== "LINE") throw new Error("QUOTE_LINE_NOT_FOUND");

  const parsed = parseQuoteQuantityInput(quantityInput);
  return replaceQuoteItem(quote, {
    ...item,
    quantity: parsed.quantity,
    quantityFormula: parsed.formula,
  });
}

export function eurosInputToQuoteCents(input: string): number {
  const value = Number(input.trim().replace(",", "."));
  if (!Number.isFinite(value) || value < 0) throw new Error("QUOTE_MONEY_INVALID");
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("QUOTE_MONEY_INVALID");
  return cents;
}

export function quoteLineHtCents(line: QuoteLine): number {
  if (line.unitPriceCents === undefined) return 0;
  const total = Math.round(line.quantity * line.unitPriceCents);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("QUOTE_MONEY_INVALID");
  return total;
}

export function quoteTotalHtCents(quote: QuoteModel): number {
  let total = 0;
  for (const item of quote.items) {
    if (item.kind !== "LINE") continue;
    total += quoteLineHtCents(item);
    if (!Number.isSafeInteger(total)) throw new Error("QUOTE_MONEY_INVALID");
  }
  return total;
}
