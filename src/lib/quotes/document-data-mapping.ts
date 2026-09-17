import type { ClientsPayload } from "@/lib/clients/domain";
import type { ClientsRepository } from "@/lib/clients/repository";
import type { CommercialPayload } from "@/lib/commercial/domain";
import type { CommercialRepository } from "@/lib/commercial/repository";
import type { CompanyProfile } from "@/lib/company-profile/domain";
import type { CompanyProfileRepository } from "@/lib/company-profile/repository";
import {
  buildQuoteDocumentData,
  type QuoteDocumentData,
} from "./document-data";
import type { QuotesRepository } from "./repository";
import type { NativeQuotesPayload } from "./store";

export type QuoteDocumentDataMappingInput = {
  quoteId: string;
  quoteNumber: string;
  clientCountry?: string;
};

export type QuoteDocumentDataPayloads = {
  quotes: NativeQuotesPayload;
  clients: ClientsPayload;
  commercial: CommercialPayload;
  companyProfile: CompanyProfile;
};

export type QuoteDocumentDataSources = {
  quotes: Pick<QuotesRepository, "load">;
  clients: Pick<ClientsRepository, "load">;
  commercial: Pick<CommercialRepository, "load">;
  companyProfile: Pick<CompanyProfileRepository, "load">;
};

export function buildQuoteDocumentDataFromPayloads(
  input: QuoteDocumentDataMappingInput,
  payloads: QuoteDocumentDataPayloads,
): QuoteDocumentData {
  const quote = payloads.quotes.quotes.find(
    (candidate) => candidate.id === input.quoteId,
  );
  if (!quote) throw new Error("QUOTE_DOCUMENT_QUOTE_NOT_FOUND");

  const commercialCase = payloads.commercial.cases.find(
    (candidate) => candidate.id === quote.commercialCaseId,
  );
  if (!commercialCase) throw new Error("QUOTE_DOCUMENT_AFFAIR_NOT_FOUND");

  const client = payloads.clients.clients.find(
    (candidate) => candidate.id === quote.model.clientId,
  );
  if (!client) throw new Error("QUOTE_DOCUMENT_CLIENT_NOT_FOUND");

  if (commercialCase.clientId && commercialCase.clientId !== client.id) {
    throw new Error("QUOTE_DOCUMENT_AFFAIR_CLIENT_MISMATCH");
  }

  return buildQuoteDocumentData({
    quote,
    client,
    commercialCase,
    company: payloads.companyProfile,
    quoteNumber: input.quoteNumber,
    clientCountry: input.clientCountry,
  });
}

export async function loadQuoteDocumentDataFromSources(
  input: QuoteDocumentDataMappingInput,
  sources: QuoteDocumentDataSources,
): Promise<QuoteDocumentData> {
  const [quotes, clients, commercial, companyProfile] = await Promise.all([
    sources.quotes.load(),
    sources.clients.load(),
    sources.commercial.load(),
    sources.companyProfile.load(),
  ]);

  return buildQuoteDocumentDataFromPayloads(input, {
    quotes,
    clients,
    commercial,
    companyProfile,
  });
}
