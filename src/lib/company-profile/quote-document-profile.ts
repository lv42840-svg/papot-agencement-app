import "server-only";

import type { QuoteDocumentCompanyProfile } from "@/lib/quotes/document-data";
import { createCompanyProfileRepository } from "./create-repository";

export async function loadQuoteDocumentCompanyProfile(): Promise<QuoteDocumentCompanyProfile> {
  return createCompanyProfileRepository().load();
}
