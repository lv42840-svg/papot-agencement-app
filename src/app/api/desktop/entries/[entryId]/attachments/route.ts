import { NextResponse } from "next/server";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { cleanupEntryAttachments, uploadEntryAttachments } from "@/lib/entries/attachment-storage";
import {
  entriesCapabilities,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";
import {
  entryExistsInDatabase,
  registerEntryAttachmentsInDatabase,
} from "@/lib/entries/postgres-repository";

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

function snapshot(
  payload: Awaited<ReturnType<typeof registerEntryAttachmentsInDatabase>>["payload"],
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
  if (code === "ENTRY_NOT_FOUND") return 404;
  if (code.includes("TOO_LARGE")) return 413;
  if (code.includes("CONFLICT")) return 409;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
  let transport: Parameters<typeof cleanupEntryAttachments>[0] | null = null;

  try {
    const { entryId } = await context.params;
    const requestContext = await requireDesktopRequestContext("capture", "WRITE");
    const { desktop, owner } = requestContext;
    const actor = actorFor(requestContext);
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENTS_REQUIRED" }, { status: 400 });
    }

    if (!(await entryExistsInDatabase(entryId))) {
      return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    }

    transport = {
      dav: desktop.dav,
      nextcloudUserId: desktop.nextcloudUserId,
      syncRoot: desktop.syncRoot,
      displayName: owner.displayName,
    };
    uploaded = await uploadEntryAttachments(transport, entryId, files);

    const mutation = await registerEntryAttachmentsInDatabase(entryId, uploaded, actor);
    return NextResponse.json(snapshot(mutation.payload, actor, entryId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (transport && uploaded.length > 0) {
      await cleanupEntryAttachments(transport, uploaded);
    }
    const code = error instanceof Error ? error.message : "ENTRY_ATTACHMENTS_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
