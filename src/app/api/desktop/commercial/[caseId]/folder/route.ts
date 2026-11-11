import { NextResponse } from "next/server";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
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

export async function GET(_request: Request, contexte: RouteContext) {
  try {
    const { caseId: idAffaire } = await contexte.params;
    await requireModuleRequestContext("commercial", "READ");
    const repository = createCommercialRepository();
    const contenu = await repository.load();
    const element = contenu.cases.find((candidat) => candidat.id === idAffaire);
    if (!element) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

    const latestDocument = element.documents[element.documents.length - 1];
    if (!latestDocument) throw new Error("COMMERCIAL_FOLDER_NOT_FOUND");

    return NextResponse.json(
      { storagePath: latestDocument.storagePath },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "COMMERCIAL_FOLDER_LOOKUP_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
