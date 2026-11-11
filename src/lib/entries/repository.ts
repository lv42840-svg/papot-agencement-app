import type { EntriesPayload, EntryAttachment } from "./domain";
import type { EntriesActor, EntriesMutation, EntriesMutationResult } from "./mutations";

export interface EntriesRepository {
  load(): Promise<EntriesPayload>;
  mutate(saisie: EntriesMutation, auteur: EntriesActor): Promise<EntriesMutationResult>;
  registerAttachments(
    idEntree: string,
    piecesJointes: EntryAttachment[],
    auteur: EntriesActor,
  ): Promise<EntriesMutationResult>;
}
