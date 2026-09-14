import { NextResponse } from "next/server";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createEntryAttachmentTransport } from "@/lib/entries/attachment-file-runtime";
import { cleanupEntryAttachments, uploadEntryAttachments } from "@/lib/entries/attachment-storage";
import { createEntriesRepository } from "@/lib/entries/create-repository";
import type { EntriesPayload } from "@/lib/entries/domain";
import {
  entriesCapabilities,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ entryId: string }> };

function actorFor(context: Awaited<ReturnType<typeof requireDesktopRequestContext>>): EntriesActor {
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    canQualify: context.moduleAccess.canWrite,
    canManageTags: context.user.canManagePermissions,
  };
}

function snapshot(payload: EntriesPayload, actor: EntriesActor, focusEntryId?: string) {
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
  if (code === "ENTRY_NOT_FOUND") return 404;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (code.includes("INTEGRITY") || code.includes("CUTOVER_VALIDATION")) return 500;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { entryId } = await context.params;
    const requestContext = await requireDesktopRequestContext("capture", "WRITE");
    const actor = actorFor(requestContext);
    const repository = await createEntriesRepository(requestContext);
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENTS_REQUIRED" }, { status: 400 });
    }

    const currentPayload = await repository.load();
    if (!currentPayload.entries.some((entry) => entry.id === entryId)) {
      return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    }

    const transport = await createEntryAttachmentTransport(requestContext);
    let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
    try {
      uploaded = await uploadEntryAttachments(transport, entryId, files);
      const mutation = await repository.registerAttachments(entryId, uploaded, actor);
      return NextResponse.json(snapshot(mutation.payload, actor, mutation.focusEntryId), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (uploaded.length > 0) await cleanupEntryAttachments(transport, uploaded);
      throw error;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRY_ATTACHMENTS_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
