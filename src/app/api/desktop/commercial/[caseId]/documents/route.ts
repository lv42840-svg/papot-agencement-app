import { NextResponse } from "next/server";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import {
  cleanupCommercialDocuments,
  uploadCommercialDocuments,
} from "@/lib/commercial/document-storage";
import { commercialDocumentCategorySchema } from "@/lib/commercial/domain";
import {
  listActiveCommercialUsers,
  loadCommercialCaseFromDatabase,
  loadCommercialPayloadFromDatabase,
  registerAffairDocuments,
} from "@/lib/commercial/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string }> };

function statusFor(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "MODULE_FORBIDDEN") return 403;
  if (code === "COMMERCIAL_CASE_NOT_FOUND") return 404;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { caseId } = await context.params;
    const requestContext = await requireDesktopRequestContext("commercial", "WRITE");
    const { desktop, user } = requestContext;
    const actor = { userId: user.id, displayName: user.displayName };
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const category = commercialDocumentCategorySchema.parse(form.get("category"));
    const versionLabel = String(form.get("versionLabel") ?? "").trim();
    const variantLabel = String(form.get("variantLabel") ?? "").trim();
    const isCurrent = String(form.get("isCurrent") ?? "1") !== "0";
    const legacySignedQuote = String(form.get("isSignedQuote") ?? "0") === "1";

    const item = await loadCommercialCaseFromDatabase(caseId);
    if (!item) return NextResponse.json({ error: "COMMERCIAL_CASE_NOT_FOUND" }, { status: 404 });

    const transport = {
      dav: desktop.dav,
      nextcloudUserId: desktop.nextcloudUserId,
      syncRoot: desktop.syncRoot,
      displayName: user.displayName,
    };
    const uploaded = await uploadCommercialDocuments(transport, {
      caseId,
      creationYear: new Date(item.createdAt).getFullYear(),
      files,
      options: {
        category,
        versionLabel,
        variantLabel,
        isCurrent,
        isSignedQuote: legacySignedQuote,
      },
    });

    try {
      await registerAffairDocuments(caseId, uploaded, actor);
    } catch (error) {
      await cleanupCommercialDocuments(transport, uploaded);
      throw error;
    }

    const [payload, activeUsers] = await Promise.all([
      loadCommercialPayloadFromDatabase(),
      listActiveCommercialUsers(),
    ]);
    return NextResponse.json(
      {
        payload,
        actor,
        capabilities: { canCreate: true, canRead: true, canModify: true, canConfirm: true },
        suggestedPeople: activeUsers.map((activeUser) => activeUser.displayName),
        activeUsers,
        focusCaseId: caseId,
        serverNow: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
