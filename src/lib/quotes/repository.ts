import type { QuotesMutationResult } from "./mutations";
import type { NativeQuotesPayload } from "./store";

export type QuotesRepositoryMutation = QuotesMutationResult & {
  shouldPersist?: boolean;
};

export type QuotesMutationTransform = (
  payload: NativeQuotesPayload,
) => QuotesRepositoryMutation | Promise<QuotesRepositoryMutation>;

export interface QuotesRepository {
  load(): Promise<NativeQuotesPayload>;
  mutate(transform: QuotesMutationTransform): Promise<QuotesMutationResult>;
}
