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

function sameVariant(gauche: string, droite: string): boolean {
  return gauche.localeCompare(droite, "fr-FR", { sensitivity: "base" }) === 0;
}

function findQuote(contenu: NativeQuotesPayload, idDevis: string): NativeQuoteRecord {
  const quote = contenu.quotes.find((candidat) => candidat.id === idDevis);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  return quote;
}

function currentVariantQuote(
  contenu: NativeQuotesPayload,
  source: NativeQuoteRecord,
): NativeQuoteRecord {
  return contenu.quotes
    .filter(
      (quote) =>
        quote.commercialCaseId === source.commercialCaseId &&
        sameVariant(quote.variantName, source.variantName),
    )
    .reduce((latest, quote) => (quote.version > latest.version ? quote : latest), source);
}

function cloneAsDraft(
  source: NativeQuoteRecord,
  auteur: QuoteLifecycleActor,
  maintenant: Date,
  variantName: string,
  version: number,
): NativeQuoteRecord {
  const id = globalThis.crypto.randomUUID();
  const timestamp = maintenant.toISOString();
  return nativeQuoteRecordSchema.parse({
    ...structuredClone(source),
    id,
    variantName,
    version,
    status: "DRAFT",
    sentAt: null,
    followUpDate: null,
    finalPdf: null,
    model: {
      ...structuredClone(source.model),
      id,
    },
    createdAt: timestamp,
    createdByName: auteur.displayName,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
}

function assertCurrentSource(contenu: NativeQuotesPayload, source: NativeQuoteRecord) {
  const courant = currentVariantQuote(contenu, source);
  if (courant.id !== source.id || source.status === "SUPERSEDED") {
    throw new Error("QUOTE_VERSION_SOURCE_OUTDATED");
  }
}

function nextAutomaticVariantName(contenu: NativeQuotesPayload, commercialCaseId: string): string {
  const existing = contenu.quotes
    .filter((quote) => quote.commercialCaseId === commercialCaseId)
    .map((quote) => quote.variantName);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of alphabet) {
    const candidat = `Variante ${letter}`;
    if (!existing.some((nom) => sameVariant(nom, candidat))) return candidat;
  }
  let indice = alphabet.length + 1;
  while (indice < 10_000) {
    const candidat = `Variante ${indice}`;
    if (!existing.some((nom) => sameVariant(nom, candidat))) return candidat;
    indice += 1;
  }
  throw new Error("QUOTE_VARIANT_NAME_UNAVAILABLE");
}

function nextDuplicateVariantName(contenu: NativeQuotesPayload, source: NativeQuoteRecord): string {
  const existing = contenu.quotes
    .filter((quote) => quote.commercialCaseId === source.commercialCaseId)
    .map((quote) => quote.variantName);
  const root = `Copie de ${source.variantName}`.slice(0, 110).trim();
  if (!existing.some((nom) => sameVariant(nom, root))) return root;
  let indice = 2;
  while (indice < 10_000) {
    const suffix = ` ${indice}`;
    const candidat = `${root.slice(0, 120 - suffix.length)}${suffix}`;
    if (!existing.some((nom) => sameVariant(nom, candidat))) return candidat;
    indice += 1;
  }
  throw new Error("QUOTE_VARIANT_NAME_UNAVAILABLE");
}

export function quoteIsCurrentVersion(contenu: NativeQuotesPayload, idDevis: string): boolean {
  const analyse = parseNativeQuotesPayload(contenu);
  const quote = findQuote(analyse, idDevis);
  return currentVariantQuote(analyse, quote).id === quote.id && quote.status !== "SUPERSEDED";
}

export function createQuoteVersion(
  sourcePayload: NativeQuotesPayload,
  idDevis: string,
  auteur: QuoteLifecycleActor,
  maintenant: Date = new Date(),
): QuoteLifecycleResult {
  const contenu = structuredClone(parseNativeQuotesPayload(sourcePayload));
  const source = findQuote(contenu, idDevis);
  assertCurrentSource(contenu, source);
  if (source.status === "ACCEPTED" || source.status === "CANCELLED") {
    throw new Error("QUOTE_VERSION_SOURCE_CLOSED");
  }

  const sourceIndex = contenu.quotes.findIndex((quote) => quote.id === source.id);
  const timestamp = maintenant.toISOString();
  contenu.quotes[sourceIndex] = nativeQuoteRecordSchema.parse({
    ...source,
    status: "SUPERSEDED",
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  const suivant = cloneAsDraft(source, auteur, maintenant, source.variantName, source.version + 1);
  contenu.quotes.push(suivant);
  return { payload: parseNativeQuotesPayload(contenu), focusQuoteId: suivant.id };
}

export function createQuoteVariant(
  sourcePayload: NativeQuotesPayload,
  idDevis: string,
  auteur: QuoteLifecycleActor,
  maintenant: Date = new Date(),
): QuoteLifecycleResult {
  const contenu = structuredClone(parseNativeQuotesPayload(sourcePayload));
  const source = findQuote(contenu, idDevis);
  assertCurrentSource(contenu, source);
  const variantName = nextAutomaticVariantName(contenu, source.commercialCaseId);
  const suivant = cloneAsDraft(source, auteur, maintenant, variantName, 1);
  contenu.quotes.push(suivant);
  return { payload: parseNativeQuotesPayload(contenu), focusQuoteId: suivant.id };
}

export function duplicateQuote(
  sourcePayload: NativeQuotesPayload,
  idDevis: string,
  auteur: QuoteLifecycleActor,
  maintenant: Date = new Date(),
): QuoteLifecycleResult {
  const contenu = structuredClone(parseNativeQuotesPayload(sourcePayload));
  const source = findQuote(contenu, idDevis);
  assertCurrentSource(contenu, source);
  const variantName = nextDuplicateVariantName(contenu, source);
  const suivant = cloneAsDraft(source, auteur, maintenant, variantName, 1);
  contenu.quotes.push(suivant);
  return { payload: parseNativeQuotesPayload(contenu), focusQuoteId: suivant.id };
}
