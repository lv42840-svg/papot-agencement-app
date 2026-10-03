import type { QuotesMutationResult } from "./mutations";
import type { NativeQuotesPayload } from "./store";

export type QuotesRepositoryMutation = QuotesMutationResult & {
  shouldPersist?: boolean;
};

export type QuotesMutationTransform = (
  payload: NativeQuotesPayload,
) => QuotesRepositoryMutation | Promise<QuotesRepositoryMutation>;

export class QuotesRepositoryError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "QuotesRepositoryError";
  }
}

export interface QuotesRepository {
  load(): Promise<NativeQuotesPayload>;
  mutate(transform: QuotesMutationTransform): Promise<QuotesMutationResult>;
}
