import { safePreviewType, documentSecurityHeaders } from "@/lib/server-files/preview";
import { NextResponse } from "next/server";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { desktopRequestErrorStatus } from "@/lib/desktop/request-context";
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

export async function GET(requete: Request, contexte: RouteContext) {
  try {
    const { entryId: idEntree, attachmentId } = await contexte.params;
    const requestContext = await requireModuleRequestContext("capture", "READ");
    const repository = await createEntriesRepository();
    const contenu = await repository.load();
    const entree = contenu.entries.find((candidat) => candidat.id === idEntree);
    if (!entree) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    const pieceJointe = entree.attachments.find((candidat) => candidat.id === attachmentId);
    if (!pieceJointe) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENT_NOT_FOUND" }, { status: 404 });
    }

    const transport = await createEntryAttachmentTransport({
      owner: { displayName: requestContext.user.displayName },
    });
    const bytes = await readEntryAttachment(transport, pieceJointe);
    const download = new URL(requete.url).searchParams.get("download") === "1";
    const previewType = safePreviewType(bytes);
    const canInline = previewType !== null;

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": previewType ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(pieceJointe.fileName, download || !canInline),
        ...documentSecurityHeaders,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "ENTRY_ATTACHMENT_READ_FAILED";
    return NextResponse.json({ error: code }, { status: statusFor(code) });
  }
}
