import type { ChantiersPayload } from "./domain";
import type { ChantierMutationResult } from "./mutations";

export type ChantiersRepositoryMutation = ChantierMutationResult & {
  shouldPersist?: boolean;
};

export type ChantiersMutationTransform = (
  payload: ChantiersPayload,
  isRetry: boolean,
) => ChantiersRepositoryMutation | Promise<ChantiersRepositoryMutation>;

export interface ChantiersRepository {
  load(): Promise<ChantiersPayload>;
  mutate(transform: ChantiersMutationTransform): Promise<ChantierMutationResult>;
}

export type ChantiersRepositoryErrorCode = "CHANTIERS_LOCKED" | "CHANTIERS_VERSION_CONFLICT";

export class ChantiersRepositoryError extends Error {
  constructor(
    code: ChantiersRepositoryErrorCode,
    readonly details?: { lockedBy?: string },
  ) {
    super(code);
    this.name = "ChantiersRepositoryError";
  }
}
