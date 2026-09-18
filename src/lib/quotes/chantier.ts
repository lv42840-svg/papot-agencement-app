import type { CommercialStatus } from "@/lib/commercial/domain";
import { parseNativeQuotesPayload, type NativeQuotesPayload } from "./store";

function sameVariant(left: string, right: string): boolean {
  return left.localeCompare(right, "fr-FR", { sensitivity: "base" }) === 0;
}

export function nextChantierComplementVariantName(
  source: NativeQuotesPayload,
  commercialCaseId: string,
): string {
  const payload = parseNativeQuotesPayload(source);
  const existing = payload.quotes
    .filter((quote) => quote.commercialCaseId === commercialCaseId)
    .map((quote) => quote.variantName);

  let index = 1;
  while (index < 10_000) {
    const candidate = `Complément ${index}`;
    if (!existing.some((name) => sameVariant(name, candidate))) return candidate;
    index += 1;
  }

  throw new Error("QUOTE_COMPLEMENT_NAME_UNAVAILABLE");
}

export function quoteWorkflowMayChangeCommercialStatus(status: CommercialStatus): boolean {
  return status !== "CONFIRMED";
}
