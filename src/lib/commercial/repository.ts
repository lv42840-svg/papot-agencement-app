import type { CommercialPayload } from "./domain";
import type { CommercialMutationResult } from "./mutations";

export type CommercialMutationTransform = (
  payload: CommercialPayload,
  isRetry: boolean,
) => CommercialMutationResult | Promise<CommercialMutationResult>;

export interface CommercialRepository {
  load(): Promise<CommercialPayload>;
  mutate(transform: CommercialMutationTransform): Promise<CommercialMutationResult>;
}

export type CommercialRepositoryErrorCode = "COMMERCIAL_LOCKED" | "COMMERCIAL_VERSION_CONFLICT";

export class CommercialRepositoryError extends Error {
  constructor(
    code: CommercialRepositoryErrorCode,
    readonly details?: { lockedBy?: string },
  ) {
    super(code);
    this.name = "CommercialRepositoryError";
  }
}
