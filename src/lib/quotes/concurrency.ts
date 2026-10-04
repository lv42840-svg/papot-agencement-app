import type { NativeQuotesPayload } from "./store";

export function quoteRevisionHeaders(updatedAt: string): Record<string, string> {
  return { "If-Match": `"${updatedAt}"` };
}

export function expectedQuoteRevision(request: Request): string {
  const raw = request.headers.get("if-match")?.trim();
  if (!raw) throw new Error("QUOTE_VERSION_REQUIRED");

  const revision =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;

  if (!revision || revision.length > 100) {
    throw new Error("QUOTE_VERSION_REQUIRED");
  }
  return revision;
}

export function assertQuoteRevision(
  payload: NativeQuotesPayload,
  quoteId: string,
  expectedRevision: string,
) {
  const quote = payload.quotes.find((candidate) => candidate.id === quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (quote.updatedAt !== expectedRevision) {
    throw new Error("QUOTE_VERSION_CONFLICT");
  }
  return quote;
}

export function quoteConcurrencyStatus(code: string): number | null {
  if (code === "QUOTE_VERSION_REQUIRED") return 428;
  if (code === "QUOTE_VERSION_CONFLICT") return 409;
  return null;
}
