import { NextResponse } from "next/server";
import { hasEffectiveSpecialPermission } from "@/lib/auth/permissions";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { ClientsRepository } from "@/lib/clients/repository";
import {
  hydrateCommercialPayloadWithCanonicalClients,
  listCanonicalCommercialClients,
} from "@/lib/commercial/client-integration";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createCommercialDocumentTransport } from "@/lib/commercial/document-file-runtime";
import {
  cleanupCommercialDocuments,
  uploadCommercialDocuments,
} from "@/lib/commercial/document-storage";
import { commercialDocumentCategorySchema, type CommercialPayload } from "@/lib/commercial/domain";
import {
  assertCommercialRevision,
  listCommercialPeople,
  registerCommercialDocuments,
} from "@/lib/commercial/mutations";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string }> };
type Owner = { userId: string; deviceId: string; displayName: string };

async function snapshot(
  contenu: CommercialPayload,
  owner: Owner,
  utilisateur: { id: string },
  clients: ClientsRepository,
  focusCaseId?: string,
) {
  const auteur = { userId: owner.userId, displayName: owner.displayName };
  const [canCreate, canProvision, canConfirm, canonicalClients] = await Promise.all([
    hasEffectiveSpecialPermission(utilisateur, "commercial.create"),
    hasEffectiveSpecialPermission(utilisateur, "commercial.provision"),
    hasEffectiveSpecialPermission(utilisateur, "commercial.confirm_launch"),
    listCanonicalCommercialClients(clients),
  ]);
  const payloadForUi = hydrateCommercialPayloadWithCanonicalClients(contenu, canonicalClients);
  return {
    payload: payloadForUi,
    actor: auteur,
    capabilities: {
      canCreate,
      canRead: true,
      canModify: true,
      canProvision,
      canConfirm,
    },
    suggestedPeople: listCommercialPeople(payloadForUi, auteur),
    focusCaseId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "COMMERCIAL_CASE_NOT_FOUND") return 404;
  if (code === "COMMERCIAL_LOCKED") return 423;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (code.includes("INTEGRITY") || code.includes("CUTOVER_VALIDATION")) return 500;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(requete: Request, contexte: RouteContext) {
  try {
    const { caseId: idAffaire } = await contexte.params;
    const requestContext = await requireModuleRequestContext("commercial", "WRITE");
    const { user: utilisateur } = requestContext;
    const owner = {
      userId: utilisateur.id,
      deviceId: utilisateur.id,
      displayName: utilisateur.displayName,
    };
    const repository = createCommercialRepository();
    const clients = await createClientsRepository();
    const form = await requete.formData();
    const fichiers = form
      .getAll("files")
      .filter((valeur): valeur is File => valeur instanceof File);
    const category = commercialDocumentCategorySchema.parse(form.get("category"));
    const versionLabel = String(form.get("versionLabel") ?? "").trim();
    const variantLabel = String(form.get("variantLabel") ?? "").trim();
    const isCurrent = String(form.get("isCurrent") ?? "1") !== "0";
    const isSignedQuote = String(form.get("isSignedQuote") ?? "0") === "1";
    const expectedUpdatedAt = String(form.get("expectedUpdatedAt") ?? "").trim();
    if (!expectedUpdatedAt) throw new Error("COMMERCIAL_VERSION_REQUIRED");

    const currentPayload = await repository.load();
    const element = currentPayload.cases.find((candidat) => candidat.id === idAffaire);
    if (!element) {
      return NextResponse.json({ error: "COMMERCIAL_CASE_NOT_FOUND" }, { status: 404 });
    }
    assertCommercialRevision(element, expectedUpdatedAt);

    const creationYear = new Date(element.createdAt).getFullYear();
    const auteur = { userId: owner.userId, displayName: owner.displayName };
    const transport = await createCommercialDocumentTransport({
      displayName: utilisateur.displayName,
    });

    let uploaded = [] as Awaited<ReturnType<typeof uploadCommercialDocuments>>;
    try {
      uploaded = await uploadCommercialDocuments(transport, {
        creationYear,
        clientName: element.clientName,
        caseName: element.name,
        files: fichiers,
        options: { category, versionLabel, variantLabel, isCurrent, isSignedQuote },
      });

      const mutation = await repository.mutate((contenu) => {
        const courant = contenu.cases.find((candidat) => candidat.id === idAffaire);
        if (!courant) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        assertCommercialRevision(courant, expectedUpdatedAt);
        return registerCommercialDocuments(contenu, idAffaire, uploaded, auteur);
      });

      return NextResponse.json(
        await snapshot(mutation.payload, owner, utilisateur, clients, idAffaire),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (erreur) {
      if (uploaded.length > 0) await cleanupCommercialDocuments(transport, uploaded);
      throw erreur;
    }
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
