import { NextResponse } from "next/server";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createCommercialDocumentTransport } from "@/lib/commercial/document-file-runtime";
import { readCommercialDocument } from "@/lib/commercial/document-storage";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string; documentId: string }> };

function disposition(fileName: string, download: boolean): string {
  const safeName = fileName.replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeName}"`;
}

function statusFor(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "MODULE_FORBIDDEN") return 403;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (code.includes("INTEGRITY") || code.includes("CUTOVER_VALIDATION")) return 500;
  return 400;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { caseId, documentId } = await context.params;
    const requestContext = await requireDesktopRequestContext("commercial", "READ");
    const repository = createCommercialRepository(requestContext);
    const payload = await repository.load();
    const item = payload.cases.find((candidate) => candidate.id === caseId);
    const document = item?.documents.find((candidate) => candidate.id === documentId);
    if (!document) {
      return NextResponse.json({ error: "COMMERCIAL_DOCUMENT_NOT_FOUND" }, { status: 404 });
    }

    const transport = await createCommercialDocumentTransport(requestContext);
    const bytes = await readCommercialDocument(transport, document);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const inline =
      document.contentType.startsWith("image/") || document.contentType === "application/pdf";

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
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
