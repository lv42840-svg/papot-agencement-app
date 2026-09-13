import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hasEffectiveSpecialPermission } from "@/lib/auth/permissions";
import {
  hydrateCommercialPayloadWithCanonicalClients,
  listCanonicalCommercialClients,
} from "@/lib/commercial/client-integration";
import {
  cleanupCommercialDocuments,
  uploadCommercialDocuments,
} from "@/lib/commercial/document-storage";
import { commercialDocumentCategorySchema, parseCommercialPayload } from "@/lib/commercial/domain";
import { listCommercialPeople, registerCommercialDocuments } from "@/lib/commercial/mutations";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMERCIAL_RESOURCE = { resource_type: "COMMERCIAL" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;
type RouteContext = { params: Promise<{ caseId: string }> };

type Owner = { userId: string; deviceId: string; displayName: string };

async function snapshot(
  payload: ReturnType<typeof parseCommercialPayload>,
  owner: Owner,
  user: { id: string },
  desktop: ReturnType<typeof createDesktopSharedResourceRuntime>,
  focusCaseId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  const [canCreate, canProvision, canConfirm, clients] = await Promise.all([
    hasEffectiveSpecialPermission(user, "commercial.create"),
    hasEffectiveSpecialPermission(user, "commercial.provision"),
    hasEffectiveSpecialPermission(user, "commercial.confirm_launch"),
    listCanonicalCommercialClients(desktop),
  ]);
  const payloadForUi = hydrateCommercialPayloadWithCanonicalClients(payload, clients);
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
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const category = commercialDocumentCategorySchema.parse(form.get("category"));
    const versionLabel = String(form.get("versionLabel") ?? "").trim();
    const variantLabel = String(form.get("variantLabel") ?? "").trim();
    const isCurrent = String(form.get("isCurrent") ?? "1") !== "0";
    const isSignedQuote = String(form.get("isSignedQuote") ?? "0") === "1";

    const current = await desktop.states.get(COMMERCIAL_RESOURCE);
    const currentPayload = parseCommercialPayload(current?.payload);
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
    const leaseId = randomUUID();
    let ownsLock = false;
    try {
      uploaded = await uploadCommercialDocuments(transport, {
        caseId,
        creationYear,
        files,
        options: { category, versionLabel, variantLabel, isCurrent, isSignedQuote },
      });

      const [lock, openedInitial] = await Promise.all([
        desktop.locks.acquire({
          resource: COMMERCIAL_RESOURCE,
          leaseId,
          owner,
          baseVersion: 0,
          ttlMs: LOCK_TTL_MS,
          reclaimOwnAfterMs: 0,
        }),
        desktop.states.openForUpdate(COMMERCIAL_RESOURCE),
      ]);
      if (lock.status === "locked") throw new Error("COMMERCIAL_LOCKED");
      ownsLock = true;

      let opened = openedInitial;
      let mutation = registerCommercialDocuments(
        parseCommercialPayload(opened.resource?.payload),
        caseId,
        uploaded,
        actor,
      );
      let saved = await desktop.states.saveOpened({
        resource: COMMERCIAL_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });

      if (saved.status === "conflict") {
        opened = await desktop.states.openForUpdate(COMMERCIAL_RESOURCE);
        mutation = registerCommercialDocuments(
          parseCommercialPayload(opened.resource?.payload),
          caseId,
          uploaded,
          actor,
        );
        saved = await desktop.states.saveOpened({
          resource: COMMERCIAL_RESOURCE,
          opened,
          payload: mutation.payload,
          actor: { userId: owner.userId, deviceId: owner.deviceId },
        });
      }
      if (saved.status === "conflict") throw new Error("COMMERCIAL_VERSION_CONFLICT");

      return NextResponse.json(
        await snapshot(
          parseCommercialPayload(saved.resource.payload),
          owner,
          user,
          desktop,
          caseId,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (uploaded.length > 0) await cleanupCommercialDocuments(transport, uploaded);
      throw error;
    } finally {
      if (ownsLock) {
        void desktop.locks
          .release({ resource: COMMERCIAL_RESOURCE, leaseId, owner })
          .catch(() => undefined);
      }
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_DOCUMENT_UPLOAD_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
