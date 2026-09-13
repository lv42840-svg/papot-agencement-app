import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import {
  cleanupEntryAttachments,
  uploadEntryAttachments,
} from "@/lib/entries/attachment-storage";
import { parseEntriesPayload } from "@/lib/entries/domain";
import {
  applyEntriesMutation,
  entriesCapabilities,
  listSuggestedAssignees,
  registerEntryAttachments,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRIES_RESOURCE = { resource_type: "ENTRIES" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;
const captureSchema = z.object({
  rawText: z.string().trim().min(1).max(4000),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  tagIds: z.array(z.string().min(1).max(100)).max(12).default([]),
});

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
  if (code === "ENTRIES_LOCKED") return 423;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(request: Request) {
  const context = await requireDesktopRequestContext("capture", "WRITE").catch((error: unknown) => {
    const code = error instanceof Error ? error.message : "AUTH_REQUIRED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  });
  if (context instanceof NextResponse) return context;

  const { desktop, owner } = context;
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);

  let rawTagIds: unknown = [];
  try {
    rawTagIds = JSON.parse(String(form.get("tagIds") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "ENTRIES_REQUEST_INVALID" }, { status: 400 });
  }

  const parsed = captureSchema.safeParse({
    rawText: String(form.get("rawText") ?? ""),
    priority: String(form.get("priority") ?? "NORMAL"),
    tagIds: rawTagIds,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "ENTRIES_REQUEST_INVALID" }, { status: 400 });
  }

  const entryId = randomUUID();
  const actor = { userId: owner.userId, displayName: owner.displayName };
  const transport = {
    dav: desktop.dav,
    nextcloudUserId: desktop.nextcloudUserId,
    syncRoot: desktop.syncRoot,
    displayName: owner.displayName,
  };
  const leaseId = randomUUID();
  let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
  let ownsLock = false;

  try {
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

    if (files.length > 0) {
      uploaded = await uploadEntryAttachments(transport, entryId, files);
    }

    let opened = openedInitial;
    let mutation = applyEntriesMutation(
      parseEntriesPayload(opened.resource?.payload),
      {
        action: "create",
        entryId,
        rawText: parsed.data.rawText,
        priority: parsed.data.priority,
        tagIds: parsed.data.tagIds,
      },
      actor,
    );
    if (uploaded.length > 0) {
      mutation = registerEntryAttachments(mutation.payload, entryId, uploaded, actor);
    }

    let saved = await desktop.states.saveOpened({
      resource: ENTRIES_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      opened = await desktop.states.openForUpdate(ENTRIES_RESOURCE);
      mutation = applyEntriesMutation(
        parseEntriesPayload(opened.resource?.payload),
        {
          action: "create",
          entryId,
          rawText: parsed.data.rawText,
          priority: parsed.data.priority,
          tagIds: parsed.data.tagIds,
        },
        actor,
      );
      if (uploaded.length > 0) {
        mutation = registerEntryAttachments(mutation.payload, entryId, uploaded, actor);
      }
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
    const code = error instanceof Error ? error.message : "ENTRIES_CAPTURE_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (ownsLock) {
      void desktop.locks
        .release({ resource: ENTRIES_RESOURCE, leaseId, owner })
        .catch(() => undefined);
    }
  }
}
