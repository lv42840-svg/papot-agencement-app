export function quoteHref(idDevis: string): string {
  const normalized = idDevis.trim();
  return normalized ? `/devis/${encodeURIComponent(normalized)}` : "/devis";
}

export const newQuoteHref = "/devis/nouveau";
