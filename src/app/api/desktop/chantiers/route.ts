import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { parseChantiersPayload, type ChantiersPayload } from "@/lib/chantiers/domain";
import {
  applyChantierMutation,
  chantierCapabilities,
  chantierMutationSchema,
} from "@/lib/chantiers/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANTIERS_RESOURCE = { resource_type: "CHANTIER" as const, resource_id: "registry" };
const LOCK_TTL_MS = 30_000;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function snapshot(
  payload: ChantiersPayload,
  owner: { userId: string; displayName: string },
  focusChantierId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  return {
    payload,
    actor,
    capabilities: chantierCapabilities(actor),
    focusChantierId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  if (code === "CHANTIERS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (code.includes("CONFLICT") || code.includes("READ_ONLY")) return 409;
  return 400;
}

export async function GET() {
  try {
    const desktop = createDesktopSharedResourceRuntime();
    const cached = desktop.states.getCached(CHANTIERS_RESOURCE);
    const resource = cached !== undefined ? cached : await desktop.states.get(CHANTIERS_RESOURCE);
    const payload = parseChantiersPayload(resource?.payload);

    if (cached !== undefined) {
      void desktop.states.get(CHANTIERS_RESOURCE).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "CHANTIERS_REFRESH_FAILED";
        console.error("[PAPOT][Chantiers] background refresh failed", { code });
      });
    }

    return noStoreJson(snapshot(payload, desktop.owner));
  } catch (error) {
    const code = error instanceof Error ? error.message : "CHANTIERS_LOAD_FAILED";
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
    const input = chantierMutationSchema.parse(await request.json());
    stage = "create-runtime";
    desktop = createDesktopSharedResourceRuntime();
    const actor = { userId: desktop.owner.userId, displayName: desktop.owner.displayName };

    stage = "acquire-lock-and-open-resource";
    const [lock, openedInitial] = await Promise.all([
      desktop.locks.acquire({
        resource: CHANTIERS_RESOURCE,
        leaseId,
        owner: desktop.owner,
        baseVersion: 0,
        ttlMs: LOCK_TTL_MS,
        reclaimOwnAfterMs: 0,
      }),
      desktop.states.openForUpdate(CHANTIERS_RESOURCE),
    ]);
    if (lock.status === "locked") {
      return noStoreJson(
        { error: "CHANTIERS_LOCKED", lockedBy: lock.lock.owner_display_name },
        { status: 423 },
      );
    }
    ownsLock = true;

    let opened = openedInitial;
    stage = "apply-mutation";
    let mutation = applyChantierMutation(parseChantiersPayload(opened.resource?.payload), input, actor);

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: CHANTIERS_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: desktop.owner.userId, deviceId: desktop.owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(CHANTIERS_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = applyChantierMutation(parseChantiersPayload(opened.resource?.payload), input, actor);
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: CHANTIERS_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: desktop.owner.userId, deviceId: desktop.owner.deviceId },
      });
    }

    if (saved.status === "conflict") throw new Error("CHANTIERS_VERSION_CONFLICT");
    const payload = parseChantiersPayload(saved.resource.payload);
    console.info("[PAPOT][Chantiers] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(snapshot(payload, desktop.owner, mutation.focusChantierId));
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "CHANTIERS_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "CHANTIERS_MUTATION_FAILED";
    console.error("[PAPOT][Chantiers] POST failed", { stage, code, ms: Date.now() - startedAt });
    return noStoreJson({ error: code }, { status: statusFor(code) });
  } finally {
    if (desktop && ownsLock) {
      const releaseDesktop = desktop;
      void releaseDesktop.locks
        .release({ resource: CHANTIERS_RESOURCE, leaseId, owner: releaseDesktop.owner })
        .catch(() => undefined);
    }
  }
}
