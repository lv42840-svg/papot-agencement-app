import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import {
  applyCommercialAutomaticTransitions,
  parseCommercialPayload,
  type CommercialPayload,
} from "@/lib/commercial/domain";
import {
  applyCommercialMutation,
  commercialCapabilities,
  commercialMutationSchema,
  listCommercialPeople,
} from "@/lib/commercial/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMERCIAL_RESOURCE = { resource_type: "COMMERCIAL" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function snapshot(
  payload: CommercialPayload,
  owner: { userId: string; displayName: string },
  focusCaseId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  return {
    payload,
    actor,
    capabilities: commercialCapabilities(actor),
    suggestedPeople: listCommercialPeople(payload, actor),
    focusCaseId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  if (code === "COMMERCIAL_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (code.includes("CONFLICT") || code.includes("CLOSED")) return 409;
  return 400;
}

async function persistAutomaticTransitions(
  desktop: ReturnType<typeof createDesktopSharedResourceRuntime>,
): Promise<CommercialPayload> {
  const leaseId = randomUUID();
  let ownsLock = false;
  try {
    const [lock, openedInitial] = await Promise.all([
      desktop.locks.acquire({
        resource: COMMERCIAL_RESOURCE,
        leaseId,
        owner: desktop.owner,
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
    let transition = applyCommercialAutomaticTransitions(parseCommercialPayload(opened.resource?.payload));
    if (!transition.changed) return transition.payload;

    let saved = await desktop.states.saveOpened({
      resource: COMMERCIAL_RESOURCE,
      opened,
      payload: transition.payload,
      actor: { userId: desktop.owner.userId, deviceId: desktop.owner.deviceId },
    });
    if (saved.status === "conflict") {
      opened = await desktop.states.openForUpdate(COMMERCIAL_RESOURCE);
      transition = applyCommercialAutomaticTransitions(parseCommercialPayload(opened.resource?.payload));
      if (!transition.changed) return transition.payload;
      saved = await desktop.states.saveOpened({
        resource: COMMERCIAL_RESOURCE,
        opened,
        payload: transition.payload,
        actor: { userId: desktop.owner.userId, deviceId: desktop.owner.deviceId },
      });
    }
    if (saved.status === "conflict") throw new Error("COMMERCIAL_VERSION_CONFLICT");
    return parseCommercialPayload(saved.resource.payload);
  } finally {
    if (ownsLock) {
      void desktop.locks
        .release({ resource: COMMERCIAL_RESOURCE, leaseId, owner: desktop.owner })
        .catch(() => undefined);
    }
  }
}

export async function GET() {
  try {
    const desktop = createDesktopSharedResourceRuntime();
    const cached = desktop.states.getCached(COMMERCIAL_RESOURCE);
    const resource = cached !== undefined ? cached : await desktop.states.get(COMMERCIAL_RESOURCE);
    const parsed = parseCommercialPayload(resource?.payload);
    const transition = applyCommercialAutomaticTransitions(parsed);

    if (transition.changed) {
      const payload = await persistAutomaticTransitions(desktop);
      return noStoreJson(snapshot(payload, desktop.owner));
    }

    if (cached !== undefined) {
      void desktop.states.get(COMMERCIAL_RESOURCE).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "COMMERCIAL_REFRESH_FAILED";
        console.error("[PAPOT][Commercial] background refresh failed", { code });
      });
    }

    return noStoreJson(snapshot(parsed, desktop.owner));
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  const startedAt = Date.now();
  let desktop: ReturnType<typeof createDesktopSharedResourceRuntime> | null = null;
  let ownsLock = false;
  let stage = "parse-request";

  try {
    const input = commercialMutationSchema.parse(await request.json());
    stage = "create-runtime";
    desktop = createDesktopSharedResourceRuntime();
    const actor = { userId: desktop.owner.userId, displayName: desktop.owner.displayName };

    stage = "acquire-lock-and-open-resource";
    const [lock, openedInitial] = await Promise.all([
      desktop.locks.acquire({
        resource: COMMERCIAL_RESOURCE,
        leaseId,
        owner: desktop.owner,
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

    let opened = openedInitial;
    stage = "apply-mutation";
    let mutation = applyCommercialMutation(parseCommercialPayload(opened.resource?.payload), input, actor);

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: COMMERCIAL_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: desktop.owner.userId, deviceId: desktop.owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(COMMERCIAL_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = applyCommercialMutation(parseCommercialPayload(opened.resource?.payload), input, actor);
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: COMMERCIAL_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: desktop.owner.userId, deviceId: desktop.owner.deviceId },
      });
    }

    if (saved.status === "conflict") throw new Error("COMMERCIAL_VERSION_CONFLICT");
    const payload = parseCommercialPayload(saved.resource.payload);
    console.info("[PAPOT][Commercial] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(snapshot(payload, desktop.owner, mutation.focusCaseId));
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "COMMERCIAL_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "COMMERCIAL_MUTATION_FAILED";
    console.error("[PAPOT][Commercial] POST failed", { stage, code, ms: Date.now() - startedAt });
    return noStoreJson({ error: code }, { status: statusFor(code) });
  } finally {
    if (desktop && ownsLock) {
      const releaseDesktop = desktop;
      void releaseDesktop.locks
        .release({ resource: COMMERCIAL_RESOURCE, leaseId, owner: releaseDesktop.owner })
        .catch(() => undefined);
    }
  }
}
