import type { NativeCreditAllowance } from "./native-credit-notes";

export type CreditPreviewMode = "FULL" | "PARTIAL";
export type CreditPreviewResult = {
  valid: boolean;
  amounts: Array<{ ratePercent: number; baseHtCents: number }>;
  htCents: number;
  vatCents: number;
  totalTtcCents: number;
  error: string | null;
};

function invalid(message: string): CreditPreviewResult {
  return { valid: false, amounts: [], htCents: 0, vatCents: 0, totalTtcCents: 0, error: message };
}

function parseEuroCents(input: string): number | null {
  const normalized = input.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Pure, client-safe preview of credit-note amounts.
 * Mirrors the server's per-rate VAT calculation, including the final VAT remainder.
 * Rejects ANY non-empty invalid field instead of quietly omitting it on issuance.
 */
export function previewNativeCreditNote(
  allowances: ReadonlyArray<
    Pick<NativeCreditAllowance, "ratePercent" | "remainingHtCents" | "remainingVatCents">
  >,
  mode: CreditPreviewMode,
  rawEuroAmounts: Readonly<Record<string, string>>,
): CreditPreviewResult {
  const amounts: CreditPreviewResult["amounts"] = [];
  let htCents = 0;
  let vatCents = 0;
  const seenRates = new Set<number>();

  for (const allowance of allowances) {
    const { ratePercent, remainingHtCents, remainingVatCents } = allowance;
    if (
      seenRates.has(ratePercent) ||
      !Number.isFinite(ratePercent) ||
      ratePercent < 0 ||
      ratePercent > 100 ||
      !Number.isSafeInteger(remainingHtCents) ||
      !Number.isSafeInteger(remainingVatCents) ||
      remainingHtCents < 0 ||
      remainingVatCents < 0
    ) {
      return invalid("Les plafonds de TVA sont incohérents. Emission suspendue.");
    }
    seenRates.add(ratePercent);
    if (remainingHtCents === 0) {
      if (remainingVatCents !== 0) return invalid("Reste de TVA incohérent.");
      continue;
    }
    const raw = rawEuroAmounts[String(ratePercent)]?.trim() ?? "";
    const amount = mode === "FULL" ? remainingHtCents : raw ? parseEuroCents(raw) : 0;
    if (
      amount === null ||
      amount === undefined ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > remainingHtCents
    ) {
      return invalid("Un montant HT est invalide ou dépasse le reste créditable.");
    }
    if (amount === 0) continue;
    const vat = amount === remainingHtCents
      ? remainingVatCents
      : Math.round((amount * ratePercent) / 100);
    if (!Number.isSafeInteger(vat) || vat > remainingVatCents) {
      return invalid("Le calcul de TVA dépasse le reste créditable.");
    }
    htCents += amount;
    vatCents += vat;
    if (!Number.isSafeInteger(htCents) || !Number.isSafeInteger(vatCents)) {
      return invalid("Le montant total de l'avoir est invalide.");
    }
    amounts.push({ ratePercent, baseHtCents: amount });
  }

  const totalTtcCents = htCents + vatCents;
  if (!amounts.length || !Number.isSafeInteger(totalTtcCents) || totalTtcCents <= 0) {
    return invalid("Saisis au moins un montant HT à créditer.");
  }
  return {
    valid: true,
    amounts,
    htCents,
    vatCents,
    totalTtcCents,
    error: null,
  };
}
