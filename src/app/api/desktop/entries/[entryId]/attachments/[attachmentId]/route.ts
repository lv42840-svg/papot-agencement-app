import { NextResponse } from "next/server";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { attachmentUrl } from "@/lib/entries/attachment-storage";
import { parseEntriesPayload } from "@/lib/entries/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRIES_RESOURCE = { resource_type: "ENTRIES" as const, resource_id: "global" };
type RouteContext = { params: Promise<{ entryId: string; attachmentId: string }> };

function contentDisposition(fileName: string, download: boolean): string {
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { entryId, attachmentId } = await context.params;
    const { desktop } = await requireDesktopRequestContext("capture", "READ");
    const resource = await desktop.states.get(ENTRIES_RESOURCE);
    const payload = parseEntriesPayload(resource?.payload);
    const entry = payload.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    const attachment = entry.attachments.find((candidate) => candidate.id === attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENT_NOT_FOUND" }, { status: 404 });
    }

    const url = attachmentUrl(
      { dav: desktop.dav, nextcloudUserId: desktop.nextcloudUserId, syncRoot: desktop.syncRoot },
      attachment,
    );
    const bytes = await desktop.dav.getBytes(url);
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
    const status = code === "AUTH_REQUIRED" ? 401 : code === "MODULE_FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
