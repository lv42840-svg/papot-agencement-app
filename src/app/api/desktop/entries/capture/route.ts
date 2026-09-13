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
import {
  entriesCapabilities,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";
import { createEntryWithAttachmentsInDatabase } from "@/lib/entries/postgres-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const captureSchema = z.object({
  rawText: z.string().trim().min(1).max(4000),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  tagIds: z.array(z.string().uuid()).max(12).default([]),
});

function actorFor(context: Awaited<ReturnType<typeof requireDesktopRequestContext>>): EntriesActor {
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    canQualify: context.moduleAccess.canWrite,
    canManageTags: context.user.canManagePermissions,
  };
}

function snapshot(
  payload: Awaited<ReturnType<typeof createEntryWithAttachmentsInDatabase>>["payload"],
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

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code.includes("TOO_LARGE")) return 413;
  if (code.includes("CONFLICT")) return 409;
  return 400;
}

export async function POST(request: Request) {
  let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
  let transport: Parameters<typeof cleanupEntryAttachments>[0] | null = null;

  try {
    const context = await requireDesktopRequestContext("capture", "WRITE");
    const { desktop, owner } = context;
    const actor = actorFor(context);
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
    transport = {
      dav: desktop.dav,
      nextcloudUserId: desktop.nextcloudUserId,
      syncRoot: desktop.syncRoot,
      displayName: owner.displayName,
    };

    if (files.length > 0) {
      uploaded = await uploadEntryAttachments(transport, entryId, files);
    }

    const mutation = await createEntryWithAttachmentsInDatabase(
      {
        entryId,
        rawText: parsed.data.rawText,
        priority: parsed.data.priority,
        tagIds: parsed.data.tagIds,
        attachments: uploaded,
      },
      actor,
    );

    return NextResponse.json(snapshot(mutation.payload, actor, entryId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (transport && uploaded.length > 0) {
      await cleanupEntryAttachments(transport, uploaded);
    }
    const code = error instanceof Error ? error.message : "ENTRIES_CAPTURE_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
