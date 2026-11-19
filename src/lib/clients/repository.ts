import type { ClientsPayload } from "./domain";
import type { ClientsActor, ClientsMutation, ClientsMutationResult } from "./mutations";

export type ClientsMutationOptions = { source: "commercialProvisional" };

export interface ClientsRepository {
  load(): Promise<ClientsPayload>;
  mutate(
    input: ClientsMutation,
    actor: ClientsActor,
    options?: ClientsMutationOptions,
  ): Promise<ClientsMutationResult>;
}

export type ClientsRepositoryErrorCode = "CLIENTS_LOCKED" | "CLIENTS_VERSION_CONFLICT";

export class ClientsRepositoryError extends Error {
  constructor(
    code: ClientsRepositoryErrorCode,
    readonly details?: { lockedBy?: string },
  ) {
    super(code);
    this.name = "ClientsRepositoryError";
  }
}
