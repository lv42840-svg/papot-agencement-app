export function quoteHref(quoteId: string): string {
  const normalized = quoteId.trim();
  return normalized ? `/devis/${encodeURIComponent(normalized)}` : "/devis";
}

export const newQuoteHref = "/devis/nouveau";
