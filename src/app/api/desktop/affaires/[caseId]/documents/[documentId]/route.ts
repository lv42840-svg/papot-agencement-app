import { NextResponse } from "next/server";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { commercialDocumentUrl } from "@/lib/commercial/document-storage";
import { findAffairDocument } from "@/lib/commercial/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string; documentId: string }> };

function disposition(fileName: string, download: boolean): string {
  const safeName = fileName.replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeName}"`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { caseId, documentId } = await context.params;
    const { desktop } = await requireDesktopRequestContext("commercial", "READ");
    const document = await findAffairDocument(caseId, documentId);
    if (!document) return NextResponse.json({ error: "COMMERCIAL_DOCUMENT_NOT_FOUND" }, { status: 404 });

    const url = commercialDocumentUrl(
      { dav: desktop.dav, nextcloudUserId: desktop.nextcloudUserId, syncRoot: desktop.syncRoot },
      document,
    );
    const bytes = await desktop.dav.getBytes(url);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const inline = document.contentType.startsWith("image/") || document.contentType === "application/pdf";

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": document.contentType || "application/octet-stream",
        "Content-Disposition": disposition(document.fileName, download || !inline),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_DOCUMENT_READ_FAILED";
    return NextResponse.json({ error: code }, { status: code === "AUTH_REQUIRED" ? 401 : code === "MODULE_FORBIDDEN" ? 403 : 400 });
  }
}
