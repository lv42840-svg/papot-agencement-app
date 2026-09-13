import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { parseEntriesPayload } from "@/lib/entries/domain";
import {
  applyEntriesMutation,
  entriesCapabilities,
  entriesMutationSchema,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRIES_RESOURCE = {
  resource_type: "ENTRIES" as const,
  resource_id: "global",
};
const ENTRIES_WRITE_LOCK_TTL_MS = 30_000;
const ENTRIES_OWN_LOCK_RECLAIM_AFTER_MS = 0;

type Owner = { userId: string; deviceId: string; displayName: string };

function actorFor(context: Awaited<ReturnType<typeof requireDesktopRequestContext>>): EntriesActor {
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    canQualify: context.moduleAccess.canWrite,
    canManageTags: context.user.canManagePermissions,
  };
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(
  payload: ReturnType<typeof parseEntriesPayload>,
  actor: EntriesActor,
  focusEntryId?: string,
) {
  return {
    payload,
    actor: { userId: actor.userId, displayName: actor.displayName },
    capabilities: entriesCapabilities(actor),
    suggestedAssignees: listSuggestedAssignees(payload, actor),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code.endsWith("_FORBIDDEN") || code === "ENTRY_NOT_ASSIGNED_TO_ACTOR") return 403;
  if (code === "ENTRIES_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("CONFLICT") || code.startsWith("ENTRY_NOT_")) return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("capture", "READ");
    const { desktop } = context;
    const actor = actorFor(context);
    const cached = desktop.states.getCached(ENTRIES_RESOURCE);

    if (cached !== undefined) {
      void desktop.states.get(ENTRIES_RESOURCE).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "ENTRIES_REFRESH_FAILED";
        console.error("[PAPOT][Entries] background refresh failed", { code });
      });
      return noStoreJson(publicSnapshot(parseEntriesPayload(cached?.payload), actor));
    }

    const resource = await desktop.states.get(ENTRIES_RESOURCE);
    return noStoreJson(publicSnapshot(parseEntriesPayload(resource?.payload), actor));
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRIES_LOAD_FAILED";
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  const startedAt = Date.now();
  let desktop: ReturnType<typeof createDesktopSharedResourceRuntime> | null = null;
  let owner: Owner | null = null;
  let ownsLock = false;
  let stage = "parse-request";

  try {
    const input = entriesMutationSchema.parse(await request.json());
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("capture", "WRITE");
    desktop = context.desktop;
    owner = context.owner;
    const actor = actorFor(context);

    stage = "acquire-lock-and-open-resource";
    const [lockResult, initialOpened] = await Promise.all([
      desktop.locks.acquire({
        resource: ENTRIES_RESOURCE,
        leaseId,
        owner,
        baseVersion: 0,
        ttlMs: ENTRIES_WRITE_LOCK_TTL_MS,
        reclaimOwnAfterMs: ENTRIES_OWN_LOCK_RECLAIM_AFTER_MS,
      }),
      desktop.states.openForUpdate(ENTRIES_RESOURCE),
    ]);

    if (lockResult.status === "locked") {
      return noStoreJson(
        {
          status: "error",
          error: "ENTRIES_LOCKED",
          lockedBy: lockResult.lock.owner_display_name,
        },
        { status: 423 },
      );
    }
    ownsLock = true;

    let opened = initialOpened;
    stage = "apply-mutation";
    let mutation = applyEntriesMutation(parseEntriesPayload(opened.resource?.payload), input, actor);

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: ENTRIES_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(ENTRIES_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = applyEntriesMutation(parseEntriesPayload(opened.resource?.payload), input, actor);
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: ENTRIES_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }

    if (saved.status === "conflict") {
      return noStoreJson(
        { status: "error", error: "ENTRIES_VERSION_CONFLICT" },
        { status: 409 },
      );
    }

    console.info("[PAPOT][Entries] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      publicSnapshot(parseEntriesPayload(saved.resource.payload), actor, mutation.focusEntryId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "ENTRIES_MUTATION_FAILED";
    console.error("[PAPOT][Entries] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  } finally {
    if (desktop && owner && ownsLock) {
      const releaseDesktop = desktop;
      const releaseOwner = owner;
      void releaseDesktop.locks
        .release({ resource: ENTRIES_RESOURCE, leaseId, owner: releaseOwner })
        .catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
          console.error("[PAPOT][Entries] lock release failed", { code });
        });
    }
  }
}
