export type QuotePricingDriver = "MARGIN" | "SALE_PRICE";

function assertMoneyCents(valeur: number): number {
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new Error("QUOTE_PRICING_MONEY_INVALID");
  }
  return valeur;
}

function assertMarginPercent(valeur: number): number {
  if (!Number.isFinite(valeur) || valeur < -100) {
    throw new Error("QUOTE_PRICING_MARGIN_INVALID");
  }
  return valeur;
}

export function parseQuoteMarginInput(valeur: string): number {
  const valeurNormalisee = valeur.trim().replace(",", ".");
  if (!valeurNormalisee) throw new Error("QUOTE_PRICING_MARGIN_INVALID");
  return assertMarginPercent(Number(valeurNormalisee));
}

export function quoteMarginToInput(valeur: number | null): string {
  if (valeur === null || !Number.isFinite(valeur)) return "";
  const valeurArrondie = Math.round(valeur * 100) / 100;
  return String(valeurArrondie).replace(".", ",");
}

export function calculateQuoteSalePriceFromMarginCents(
  coutCentimes: number,
  margePourcent: number,
): number {
  const cout = assertMoneyCents(coutCentimes);
  const marge = assertMarginPercent(margePourcent);
  const prixVenteCentimes = Math.round(cout * (1 + marge / 100));
  return assertMoneyCents(prixVenteCentimes);
}

export function calculateQuoteMarginFromSalePrice(
  coutCentimes: number,
  prixVenteCentimes: number,
): number | null {
  const cout = assertMoneyCents(coutCentimes);
  const vente = assertMoneyCents(prixVenteCentimes);
  if (cout === 0) return vente === 0 ? 0 : null;
  return ((vente - cout) / cout) * 100;
}
