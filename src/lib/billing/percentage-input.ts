/**
 * Percentages must be explicitly entered: Number("") would otherwise yield 0.
 * Accept French commas and up to two decimal places.
 */
export function parseBillingPercentageInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const percent = Number(normalized);
  return Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : null;
}
