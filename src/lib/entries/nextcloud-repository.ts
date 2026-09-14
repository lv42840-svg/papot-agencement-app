import { randomUUID } from "node:crypto";
import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { parseEntriesPayload } from "./domain";
import {
  applyEntriesMutation,
  registerEntryAttachments,
  type EntriesMutationResult,
} from "./mutations";
import type { EntriesRepository } from "./repository";

const ENTRIES_RESOURCE = { resource_type: "ENTRIES" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;

type Desktop = DesktopRequestContext["desktop"];
type Owner = DesktopRequestContext["owner"];

export function createNextcloudEntriesRepository(params: {
  desktop: Desktop;
  owner: Owner;
}): EntriesRepository {
  async function persist(
    transform: (payload: ReturnType<typeof parseEntriesPayload>) => EntriesMutationResult,
  ): Promise<EntriesMutationResult> {
    const leaseId = randomUUID();
    let ownsLock = false;

    try {
      const [lockResult, initialOpened] = await Promise.all([
        params.desktop.locks.acquire({
          resource: ENTRIES_RESOURCE,
          leaseId,
          owner: params.owner,
          baseVersion: 0,
          ttlMs: LOCK_TTL_MS,
          reclaimOwnAfterMs: 0,
        }),
        params.desktop.states.openForUpdate(ENTRIES_RESOURCE),
      ]);
      if (lockResult.status === "locked") throw new Error("ENTRIES_LOCKED");
      ownsLock = true;

      let opened = initialOpened;
      let mutation = transform(parseEntriesPayload(opened.resource?.payload));
      let saved = await params.desktop.states.saveOpened({
        resource: ENTRIES_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
      });

      if (saved.status === "conflict") {
        opened = await params.desktop.states.openForUpdate(ENTRIES_RESOURCE);
        mutation = transform(parseEntriesPayload(opened.resource?.payload));
        saved = await params.desktop.states.saveOpened({
          resource: ENTRIES_RESOURCE,
          opened,
          payload: mutation.payload,
          actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
        });
      }
      if (saved.status === "conflict") throw new Error("ENTRIES_VERSION_CONFLICT");

      return {
        payload: parseEntriesPayload(saved.resource.payload),
        focusEntryId: mutation.focusEntryId,
      };
    } finally {
      if (ownsLock) {
        void params.desktop.locks
          .release({ resource: ENTRIES_RESOURCE, leaseId, owner: params.owner })
          .catch((error: unknown) => {
            const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
            console.error("[PAPOT][Entries] lock release failed", { code });
          });
      }
    }
  }

  return {
    async load() {
      const cached = params.desktop.states.getCached(ENTRIES_RESOURCE);
      if (cached !== undefined) {
        void params.desktop.states.get(ENTRIES_RESOURCE).catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "ENTRIES_REFRESH_FAILED";
          console.error("[PAPOT][Entries] background refresh failed", { code });
        });
        return parseEntriesPayload(cached?.payload);
      }
      const resource = await params.desktop.states.get(ENTRIES_RESOURCE);
      return parseEntriesPayload(resource?.payload);
    },
    async mutate(input, actor) {
      return persist((payload) => applyEntriesMutation(payload, input, actor));
    },
    async registerAttachments(entryId, attachments, actor) {
      return persist((payload) => registerEntryAttachments(payload, entryId, attachments, actor));
    },
  };
}
