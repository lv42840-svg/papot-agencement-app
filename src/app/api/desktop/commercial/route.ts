import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { commercialSpecialPermissionForMutation } from "@/lib/auth/action-permissions";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import {
  assertCommercialClientReadyForConfirmation,
  hydrateCommercialPayloadWithCanonicalClients,
  listCanonicalCommercialClients,
  resolveCommercialClient,
  type ResolvedCommercialClient,
} from "@/lib/commercial/client-integration";
import {
  applyCommercialAutomaticTransitions,
  parseCommercialPayload,
  type CommercialPayload,
} from "@/lib/commercial/domain";
import {
  applyCommercialMutation,
  commercialMutationSchema,
  listCommercialPeople,
  type CommercialMutation,
  type CommercialMutationResult,
} from "@/lib/commercial/mutations";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMERCIAL_RESOURCE = { resource_type: "COMMERCIAL" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;

type Owner = { userId: string; deviceId: string; displayName: string };
type RawRequest = Record<string, unknown>;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function rawString(raw: RawRequest, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function confirmationRequested(input: CommercialMutation): boolean {
  return (
    (input.action === "setStatus" && input.status === "CONFIRMED") ||
    (input.action === "recordFollowUp" && input.nextStatus === "CONFIRMED")
  );
}

function caseIdForMutation(input: CommercialMutation): string | null {
  if (input.action === "create") return null;
  return "caseId" in input ? input.caseId : null;
}

function linkResolvedClient(
  mutation: CommercialMutationResult,
  resolvedClient: ResolvedCommercialClient,
  actorName: string,
): void {
  if (!mutation.focusCaseId) return;
  const item = mutation.payload.cases.find((candidate) => candidate.id === mutation.focusCaseId);
  if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

  const previousClientId = item.clientId ?? null;
  const previousName = item.clientName ?? null;
  item.clientId = resolvedClient.id;
  item.primaryContactId = null;
  item.clientName = resolvedClient.displayName;

  if (previousClientId !== resolvedClient.id || previousName !== resolvedClient.displayName) {
    item.history.push({
      id: randomUUID(),
      type: "CLIENT_LINKED",
      at: new Date().toISOString(),
      actorName,
      summary: `Client lié : ${resolvedClient.displayName}.`,
    });
  }
}

async function snapshot(
  payload: CommercialPayload,
  owner: Owner,
  canWrite: boolean,
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
      canCreate: canWrite && canCreate,
      canRead: true,
      canModify: canWrite,
      canProvision: canWrite && canProvision,
      canConfirm: canWrite && canConfirm,
    },
    suggestedPeople: listCommercialPeople(payloadForUi, actor),
    focusCaseId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "COMMERCIAL_LOCKED" || code === "CLIENTS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (
    code.includes("CONFLICT") ||
    code.includes("CLOSED") ||
    code === "COMMERCIAL_CLIENT_INCOMPLETE"
  ) {
    return 409;
  }
  return 400;
}

async function persistAutomaticTransitions(
  desktop: ReturnType<typeof createDesktopSharedResourceRuntime>,
  owner: Owner,
): Promise<CommercialPayload> {
  const leaseId = randomUUID();
  let ownsLock = false;
  try {
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
    if (lock.status === "locked") {
      const current = await desktop.states.get(COMMERCIAL_RESOURCE);
      return applyCommercialAutomaticTransitions(parseCommercialPayload(current?.payload)).payload;
    }
    ownsLock = true;

    let opened = openedInitial;
    let transition = applyCommercialAutomaticTransitions(
      parseCommercialPayload(opened.resource?.payload),
    );
    if (!transition.changed) return transition.payload;

    let saved = await desktop.states.saveOpened({
      resource: COMMERCIAL_RESOURCE,
      opened,
      payload: transition.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });
    if (saved.status === "conflict") {
      opened = await desktop.states.openForUpdate(COMMERCIAL_RESOURCE);
      transition = applyCommercialAutomaticTransitions(
        parseCommercialPayload(opened.resource?.payload),
      );
      if (!transition.changed) return transition.payload;
      saved = await desktop.states.saveOpened({
        resource: COMMERCIAL_RESOURCE,
        opened,
        payload: transition.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }
    if (saved.status === "conflict") throw new Error("COMMERCIAL_VERSION_CONFLICT");
    return parseCommercialPayload(saved.resource.payload);
  } finally {
    if (ownsLock) {
      void desktop.locks
        .release({ resource: COMMERCIAL_RESOURCE, leaseId, owner })
        .catch(() => undefined);
    }
  }
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("commercial", "READ");
    const { desktop, owner } = context;
    const cached = desktop.states.getCached(COMMERCIAL_RESOURCE);
    const resource = cached !== undefined ? cached : await desktop.states.get(COMMERCIAL_RESOURCE);
    const parsed = parseCommercialPayload(resource?.payload);
    const transition = applyCommercialAutomaticTransitions(parsed);

    if (transition.changed) {
      const payload = context.moduleAccess.canWrite
        ? await persistAutomaticTransitions(desktop, owner)
        : transition.payload;
      return noStoreJson(
        await snapshot(
          payload,
          owner,
          context.moduleAccess.canWrite,
          context.user,
          desktop,
        ),
      );
    }

    if (cached !== undefined) {
      void desktop.states.get(COMMERCIAL_RESOURCE).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "COMMERCIAL_REFRESH_FAILED";
        console.error("[PAPOT][Commercial] background refresh failed", { code });
      });
    }

    return noStoreJson(
      await snapshot(parsed, owner, context.moduleAccess.canWrite, context.user, desktop),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  const startedAt = Date.now();
  let desktop: ReturnType<typeof createDesktopSharedResourceRuntime> | null = null;
  let owner: Owner | null = null;
  let ownsLock = false;
  let stage = "parse-request";

  try {
    const raw = (await request.json()) as RawRequest;
    const input = commercialMutationSchema.parse(raw);
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("commercial", "WRITE");
    const requiredSpecialPermission = commercialSpecialPermissionForMutation(input);
    if (requiredSpecialPermission) {
      await requireSpecialPermission(context.user, requiredSpecialPermission);
    }
    desktop = context.desktop;
    owner = context.owner;
    const actor = { userId: owner.userId, displayName: owner.displayName };

    stage = "acquire-lock-and-open-resource";
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
    if (lock.status === "locked") {
      return noStoreJson(
        { error: "COMMERCIAL_LOCKED", lockedBy: lock.lock.owner_display_name },
        { status: 423 },
      );
    }
    ownsLock = true;

    let resolvedClient: ResolvedCommercialClient | null = null;

    const buildMutation = async (
      source: CommercialPayload,
      allowClientCreation: boolean,
    ): Promise<CommercialMutationResult> => {
      if (confirmationRequested(input)) {
        const caseId = caseIdForMutation(input);
        const item = caseId ? source.cases.find((candidate) => candidate.id === caseId) : null;
        if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        await assertCommercialClientReadyForConfirmation(desktop!, item.clientId);
      }

      const result = applyCommercialMutation(source, input, actor);

      if (input.action === "create" || input.action === "updateDetails") {
        const currentItem =
          input.action === "updateDetails"
            ? source.cases.find((candidate) => candidate.id === input.caseId)
            : null;
        if (input.action === "updateDetails" && !currentItem) {
          throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        }

        if (!resolvedClient) {
          if (!allowClientCreation) throw new Error("COMMERCIAL_CLIENT_RESOLUTION_LOST");
          stage = "resolve-client";
          resolvedClient = await resolveCommercialClient({
            desktop: desktop!,
            owner: owner!,
            actor,
            existingClientId: rawString(raw, "existingClientId"),
            newClientName: input.clientName,
            currentClientId: currentItem?.clientId ?? null,
          });
        }
        linkResolvedClient(result, resolvedClient, actor.displayName);
      }

      return result;
    };

    let opened = openedInitial;
    stage = "apply-mutation";
    let mutation = await buildMutation(
      parseCommercialPayload(opened.resource?.payload),
      true,
    );

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: COMMERCIAL_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(COMMERCIAL_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = await buildMutation(
        parseCommercialPayload(opened.resource?.payload),
        false,
      );
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: COMMERCIAL_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }

    if (saved.status === "conflict") throw new Error("COMMERCIAL_VERSION_CONFLICT");
    const payload = parseCommercialPayload(saved.resource.payload);
    console.info("[PAPOT][Commercial] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      await snapshot(payload, owner, true, context.user, desktop, mutation.focusCaseId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "COMMERCIAL_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "COMMERCIAL_MUTATION_FAILED";
    console.error("[PAPOT][Commercial] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ error: code }, { status: statusFor(code) });
  } finally {
    if (desktop && owner && ownsLock) {
      const releaseDesktop = desktop;
      const releaseOwner = owner;
      void releaseDesktop.locks
        .release({ resource: COMMERCIAL_RESOURCE, leaseId, owner: releaseOwner })
        .catch(() => undefined);
    }
  }
}
