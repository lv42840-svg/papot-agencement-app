import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parseEntriesPayload } from "./domain";
import { applyEntriesMutation, registerEntryAttachments } from "./mutations";
import type { EntriesRepository } from "./repository";

const RESOURCE_KEY = "entries";

export function createLocalEntriesRepository(): EntriesRepository {
  const persist = <T>(
    transform: (payload: ReturnType<typeof parseEntriesPayload>) => {
      payload: ReturnType<typeof parseEntriesPayload>;
      focusEntryId: string | null;
    } & T,
  ) =>
    mutateLocalSnapshot(RESOURCE_KEY, parseEntriesPayload, ({ payload }) => {
      const mutation = transform(structuredClone(payload));
      return { payload: mutation.payload, result: mutation };
    });

  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseEntriesPayload).payload;
    },
    async mutate(input, actor) {
      return persist((payload) => applyEntriesMutation(payload, input, actor));
    },
    async registerAttachments(entryId, attachments, actor) {
      return persist((payload) => registerEntryAttachments(payload, entryId, attachments, actor));
    },
  };
}
