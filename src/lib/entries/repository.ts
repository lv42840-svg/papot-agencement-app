import type { EntriesPayload, EntryAttachment } from "./domain";
import type { EntriesActor, EntriesMutation, EntriesMutationResult } from "./mutations";

export interface EntriesRepository {
  load(): Promise<EntriesPayload>;
  mutate(
    input: EntriesMutation,
    actor: EntriesActor,
    expectedRevision?: string,
  ): Promise<EntriesMutationResult>;
  registerAttachments(
    entryId: string,
    attachments: EntryAttachment[],
    actor: EntriesActor,
    expectedRevision?: string,
  ): Promise<EntriesMutationResult>;
}
