import { NextResponse } from "next/server";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createEntryAttachmentTransport } from "@/lib/entries/attachment-file-runtime";
import { readEntryAttachment } from "@/lib/entries/attachment-storage";
import { createEntriesRepository } from "@/lib/entries/create-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ entryId: string; attachmentId: string }> };

function contentDisposition(fileName: string, download: boolean): string {
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "ENTRY_NOT_FOUND" || code === "ENTRY_ATTACHMENT_NOT_FOUND") return 404;
  if (code === "SERVER_FILE_NOT_FOUND") return 404;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (code.includes("INTEGRITY") || code.includes("CUTOVER_VALIDATION")) return 500;
  return 400;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { entryId, attachmentId } = await context.params;
    const requestContext = await requireDesktopRequestContext("capture", "READ");
    const repository = await createEntriesRepository(requestContext);
    const payload = await repository.load();
    const entry = payload.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    const attachment = entry.attachments.find((candidate) => candidate.id === attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENT_NOT_FOUND" }, { status: 404 });
    }

    const transport = await createEntryAttachmentTransport(requestContext);
    const bytes = await readEntryAttachment(transport, attachment);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const canInline =
      attachment.contentType.startsWith("image/") || attachment.contentType === "application/pdf";

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": attachment.contentType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(attachment.fileName, download || !canInline),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRY_ATTACHMENT_READ_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
