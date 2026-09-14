import { NextResponse } from "next/server";
import { hasEffectiveSpecialPermission } from "@/lib/auth/permissions";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { ClientsRepository } from "@/lib/clients/repository";
import {
  hydrateCommercialPayloadWithCanonicalClients,
  listCanonicalCommercialClients,
} from "@/lib/commercial/client-integration";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  cleanupCommercialDocuments,
  uploadCommercialDocuments,
} from "@/lib/commercial/document-storage";
import { commercialDocumentCategorySchema, type CommercialPayload } from "@/lib/commercial/domain";
import { listCommercialPeople, registerCommercialDocuments } from "@/lib/commercial/mutations";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string }> };
type Owner = { userId: string; deviceId: string; displayName: string };

async function snapshot(
  payload: CommercialPayload,
  owner: Owner,
  user: { id: string },
  clients: ClientsRepository,
  focusCaseId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  const [canCreate, canProvision, canConfirm, canonicalClients] = await Promise.all([
    hasEffectiveSpecialPermission(user, "commercial.create"),
    hasEffectiveSpecialPermission(user, "commercial.provision"),
    hasEffectiveSpecialPermission(user, "commercial.confirm_launch"),
    listCanonicalCommercialClients(clients),
  ]);
  const payloadForUi = hydrateCommercialPayloadWithCanonicalClients(payload, canonicalClients);
  return {
    payload: payloadForUi,
    actor,
    capabilities: {
      canCreate,
      canRead: true,
      canModify: true,
      canProvision,
      canConfirm,
    },
    suggestedPeople: listCommercialPeople(payloadForUi, actor),
    focusCaseId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "COMMERCIAL_CASE_NOT_FOUND") return 404;
  if (code === "COMMERCIAL_LOCKED") return 423;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { caseId } = await context.params;
    const requestContext = await requireDesktopRequestContext("commercial", "WRITE");
    const { desktop, owner, user } = requestContext;
    const repository = createCommercialRepository(requestContext);
    const clients = await createClientsRepository(requestContext);
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const category = commercialDocumentCategorySchema.parse(form.get("category"));
    const versionLabel = String(form.get("versionLabel") ?? "").trim();
    const variantLabel = String(form.get("variantLabel") ?? "").trim();
    const isCurrent = String(form.get("isCurrent") ?? "1") !== "0";
    const isSignedQuote = String(form.get("isSignedQuote") ?? "0") === "1";

    const currentPayload = await repository.load();
    const item = currentPayload.cases.find((candidate) => candidate.id === caseId);
    if (!item) {
      return NextResponse.json({ error: "COMMERCIAL_CASE_NOT_FOUND" }, { status: 404 });
    }

    const creationYear = new Date(item.createdAt).getFullYear();
    const actor = { userId: owner.userId, displayName: owner.displayName };
    const transport = {
      dav: desktop.dav,
      nextcloudUserId: desktop.nextcloudUserId,
      syncRoot: desktop.syncRoot,
      displayName: owner.displayName,
    };

    let uploaded = [] as Awaited<ReturnType<typeof uploadCommercialDocuments>>;
    try {
      uploaded = await uploadCommercialDocuments(transport, {
        caseId,
        creationYear,
        files,
        options: { category, versionLabel, variantLabel, isCurrent, isSignedQuote },
      });

      const mutation = await repository.mutate((payload) =>
        registerCommercialDocuments(payload, caseId, uploaded, actor),
      );

      return NextResponse.json(
        await snapshot(mutation.payload, owner, user, clients, caseId),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (uploaded.length > 0) await cleanupCommercialDocuments(transport, uploaded);
      throw error;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
