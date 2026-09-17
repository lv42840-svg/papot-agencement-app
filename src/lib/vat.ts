import { z } from "zod";

export const DEFAULT_VAT_RATE_PERCENT = 20;

export const vatRatePercentSchema = z.number().finite().min(0).max(100);

export function normalizeVatRatePercent(value: number): number {
  return vatRatePercentSchema.parse(value);
}
