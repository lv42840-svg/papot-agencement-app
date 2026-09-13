import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { cleanupEntryAttachments, uploadEntryAttachments } from "@/lib/entries/attachment-storage";
import { parseEntriesPayload } from "@/lib/entries/domain";
import {
  entriesCapabilities,
  listSuggestedAssignees,
  registerEntryAttachments,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRIES_RESOURCE = { resource_type: "ENTRIES" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;

type RouteContext = { params: Promise<{ entryId: string }> };

function snapshot(
  payload: ReturnType<typeof parseEntriesPayload>,
  owner: { userId: string; displayName: string },
  focusEntryId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  return {
    payload,
    actor,
    capabilities: entriesCapabilities(actor),
    suggestedAssignees: listSuggestedAssignees(payload, actor),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "ENTRY_NOT_FOUND") return 404;
  if (code === "ENTRIES_LOCKED") return 423;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { entryId } = await context.params;
    const requestContext = await requireDesktopRequestContext("capture", "WRITE");
    const { desktop, owner } = requestContext;
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENTS_REQUIRED" }, { status: 400 });
    }

    const actor = { userId: owner.userId, displayName: owner.displayName };
    const transport = {
      dav: desktop.dav,
      nextcloudUserId: desktop.nextcloudUserId,
      syncRoot: desktop.syncRoot,
      displayName: owner.displayName,
    };

    const current = await desktop.states.get(ENTRIES_RESOURCE);
    const currentPayload = parseEntriesPayload(current?.payload);
    if (!currentPayload.entries.some((entry) => entry.id === entryId)) {
      return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    }

    let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
    const leaseId = randomUUID();
    let ownsLock = false;
    try {
      uploaded = await uploadEntryAttachments(transport, entryId, files);

      const [lock, openedInitial] = await Promise.all([
        desktop.locks.acquire({
          resource: ENTRIES_RESOURCE,
          leaseId,
          owner,
          baseVersion: 0,
          ttlMs: LOCK_TTL_MS,
          reclaimOwnAfterMs: 0,
        }),
        desktop.states.openForUpdate(ENTRIES_RESOURCE),
      ]);
      if (lock.status === "locked") throw new Error("ENTRIES_LOCKED");
      ownsLock = true;

      let opened = openedInitial;
      let mutation = registerEntryAttachments(
        parseEntriesPayload(opened.resource?.payload),
        entryId,
        uploaded,
        actor,
      );
      let saved = await desktop.states.saveOpened({
        resource: ENTRIES_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });

      if (saved.status === "conflict") {
        opened = await desktop.states.openForUpdate(ENTRIES_RESOURCE);
        mutation = registerEntryAttachments(
          parseEntriesPayload(opened.resource?.payload),
          entryId,
          uploaded,
          actor,
        );
        saved = await desktop.states.saveOpened({
          resource: ENTRIES_RESOURCE,
          opened,
          payload: mutation.payload,
          actor: { userId: owner.userId, deviceId: owner.deviceId },
        });
      }
      if (saved.status === "conflict") throw new Error("ENTRIES_VERSION_CONFLICT");

      return NextResponse.json(snapshot(parseEntriesPayload(saved.resource.payload), owner, entryId), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (uploaded.length > 0) await cleanupEntryAttachments(transport, uploaded);
      throw error;
    } finally {
      if (ownsLock) {
        void desktop.locks
          .release({ resource: ENTRIES_RESOURCE, leaseId, owner })
          .catch(() => undefined);
      }
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRY_ATTACHMENTS_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
