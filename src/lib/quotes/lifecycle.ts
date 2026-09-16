import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuoteRecord,
  type NativeQuotesPayload,
} from "./store";

export type QuoteLifecycleActor = {
  userId: string;
  displayName: string;
};

export type QuoteLifecycleResult = {
  payload: NativeQuotesPayload;
  focusQuoteId: string;
};

function sameVariant(left: string, right: string): boolean {
  return left.localeCompare(right, "fr-FR", { sensitivity: "base" }) === 0;
}

function findQuote(payload: NativeQuotesPayload, quoteId: string): NativeQuoteRecord {
  const quote = payload.quotes.find((candidate) => candidate.id === quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  return quote;
}

function currentVariantQuote(
  payload: NativeQuotesPayload,
  source: NativeQuoteRecord,
): NativeQuoteRecord {
  return payload.quotes
    .filter(
      (quote) =>
        quote.commercialCaseId === source.commercialCaseId &&
        sameVariant(quote.variantName, source.variantName),
    )
    .reduce((latest, quote) => (quote.version > latest.version ? quote : latest), source);
}

function cloneAsDraft(
  source: NativeQuoteRecord,
  actor: QuoteLifecycleActor,
  now: Date,
  variantName: string,
  version: number,
): NativeQuoteRecord {
  const id = globalThis.crypto.randomUUID();
  const timestamp = now.toISOString();
  return nativeQuoteRecordSchema.parse({
    ...structuredClone(source),
    id,
    variantName,
    version,
    status: "DRAFT",
    sentAt: null,
    followUpDate: null,
    model: {
      ...structuredClone(source.model),
      id,
    },
    createdAt: timestamp,
    createdByName: actor.displayName,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
}

function assertCurrentSource(payload: NativeQuotesPayload, source: NativeQuoteRecord) {
  const current = currentVariantQuote(payload, source);
  if (current.id !== source.id || source.status === "SUPERSEDED") {
    throw new Error("QUOTE_VERSION_SOURCE_OUTDATED");
  }
}

function nextAutomaticVariantName(
  payload: NativeQuotesPayload,
  commercialCaseId: string,
): string {
  const existing = payload.quotes
    .filter((quote) => quote.commercialCaseId === commercialCaseId)
    .map((quote) => quote.variantName);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of alphabet) {
    const candidate = `Variante ${letter}`;
    if (!existing.some((name) => sameVariant(name, candidate))) return candidate;
  }
  let index = alphabet.length + 1;
  while (index < 10_000) {
    const candidate = `Variante ${index}`;
    if (!existing.some((name) => sameVariant(name, candidate))) return candidate;
    index += 1;
  }
  throw new Error("QUOTE_VARIANT_NAME_UNAVAILABLE");
}

function nextDuplicateVariantName(
  payload: NativeQuotesPayload,
  source: NativeQuoteRecord,
): string {
  const existing = payload.quotes
    .filter((quote) => quote.commercialCaseId === source.commercialCaseId)
    .map((quote) => quote.variantName);
  const root = `Copie de ${source.variantName}`.slice(0, 110).trim();
  if (!existing.some((name) => sameVariant(name, root))) return root;
  let index = 2;
  while (index < 10_000) {
    const suffix = ` ${index}`;
    const candidate = `${root.slice(0, 120 - suffix.length)}${suffix}`;
    if (!existing.some((name) => sameVariant(name, candidate))) return candidate;
    index += 1;
  }
  throw new Error("QUOTE_VARIANT_NAME_UNAVAILABLE");
}

export function quoteIsCurrentVersion(
  payload: NativeQuotesPayload,
  quoteId: string,
): boolean {
  const parsed = parseNativeQuotesPayload(payload);
  const quote = findQuote(parsed, quoteId);
  return currentVariantQuote(parsed, quote).id === quote.id && quote.status !== "SUPERSEDED";
}

export function createQuoteVersion(
  sourcePayload: NativeQuotesPayload,
  quoteId: string,
  actor: QuoteLifecycleActor,
  now: Date = new Date(),
): QuoteLifecycleResult {
  const payload = structuredClone(parseNativeQuotesPayload(sourcePayload));
  const source = findQuote(payload, quoteId);
  assertCurrentSource(payload, source);
  if (source.status === "ACCEPTED" || source.status === "CANCELLED") {
    throw new Error("QUOTE_VERSION_SOURCE_CLOSED");
  }

  const sourceIndex = payload.quotes.findIndex((quote) => quote.id === source.id);
  const timestamp = now.toISOString();
  payload.quotes[sourceIndex] = nativeQuoteRecordSchema.parse({
    ...source,
    status: "SUPERSEDED",
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  const next = cloneAsDraft(source, actor, now, source.variantName, source.version + 1);
  payload.quotes.push(next);
  return { payload: parseNativeQuotesPayload(payload), focusQuoteId: next.id };
}

export function createQuoteVariant(
  sourcePayload: NativeQuotesPayload,
  quoteId: string,
  actor: QuoteLifecycleActor,
  now: Date = new Date(),
): QuoteLifecycleResult {
  const payload = structuredClone(parseNativeQuotesPayload(sourcePayload));
  const source = findQuote(payload, quoteId);
  assertCurrentSource(payload, source);
  const variantName = nextAutomaticVariantName(payload, source.commercialCaseId);
  const next = cloneAsDraft(source, actor, now, variantName, 1);
  payload.quotes.push(next);
  return { payload: parseNativeQuotesPayload(payload), focusQuoteId: next.id };
}

export function duplicateQuote(
  sourcePayload: NativeQuotesPayload,
  quoteId: string,
  actor: QuoteLifecycleActor,
  now: Date = new Date(),
): QuoteLifecycleResult {
  const payload = structuredClone(parseNativeQuotesPayload(sourcePayload));
  const source = findQuote(payload, quoteId);
  assertCurrentSource(payload, source);
  const variantName = nextDuplicateVariantName(payload, source);
  const next = cloneAsDraft(source, actor, now, variantName, 1);
  payload.quotes.push(next);
  return { payload: parseNativeQuotesPayload(payload), focusQuoteId: next.id };
}
