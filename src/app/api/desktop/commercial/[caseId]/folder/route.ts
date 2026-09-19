import { NextResponse } from "next/server";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string }> };

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "COMMERCIAL_CASE_NOT_FOUND" || code === "COMMERCIAL_FOLDER_NOT_FOUND") return 404;
  return 400;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { caseId } = await context.params;
    const requestContext = await requireDesktopRequestContext("commercial", "READ");
    const repository = createCommercialRepository(requestContext);
    const payload = await repository.load();
    const item = payload.cases.find((candidate) => candidate.id === caseId);
    if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

    const latestDocument = item.documents[item.documents.length - 1];
    if (!latestDocument) throw new Error("COMMERCIAL_FOLDER_NOT_FOUND");

    return NextResponse.json(
      { storagePath: latestDocument.storagePath },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_FOLDER_LOOKUP_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
