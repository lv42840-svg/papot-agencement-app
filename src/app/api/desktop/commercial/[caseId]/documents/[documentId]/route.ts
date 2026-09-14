import { NextResponse } from "next/server";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { commercialDocumentUrl } from "@/lib/commercial/document-storage";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string; documentId: string }> };

function contentDisposition(fileName: string, download: boolean): string {
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { caseId, documentId } = await context.params;
    const requestContext = await requireDesktopRequestContext("commercial", "READ");
    const { desktop } = requestContext;
    const repository = createCommercialRepository(requestContext);
    const payload = await repository.load();
    const item = payload.cases.find((candidate) => candidate.id === caseId);
    if (!item) {
      return NextResponse.json({ error: "COMMERCIAL_CASE_NOT_FOUND" }, { status: 404 });
    }
    const document = item.documents.find((candidate) => candidate.id === documentId);
    if (!document) {
      return NextResponse.json({ error: "COMMERCIAL_DOCUMENT_NOT_FOUND" }, { status: 404 });
    }

    const url = commercialDocumentUrl(
      { dav: desktop.dav, nextcloudUserId: desktop.nextcloudUserId, syncRoot: desktop.syncRoot },
      document,
    );
    const bytes = await desktop.dav.getBytes(url);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const canInline =
      document.contentType.startsWith("image/") || document.contentType === "application/pdf";

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": document.contentType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(document.fileName, download || !canInline),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_DOCUMENT_READ_FAILED";
    const status = code === "AUTH_REQUIRED" ? 401 : code === "MODULE_FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
