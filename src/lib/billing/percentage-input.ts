/**
 * Percentages must be explicitly entered: Number("") would otherwise yield 0.
 * Accept French commas and up to two decimal places.
 */
export function parseBillingPercentageInput(brut: string): number | null {
  const normalise = brut.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalise)) return null;
  const pourcentage = Number(normalise);
  return Number.isFinite(pourcentage) &&
    pourcentage > 0 &&
    pourcentage <= 100
    ? pourcentage
    : null;
}
