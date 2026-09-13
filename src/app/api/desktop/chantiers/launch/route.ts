import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { parseCommercialPayload } from "@/lib/commercial/domain";
import { parseChantiersPayload } from "@/lib/chantiers/domain";
import {
  chantierCapabilities,
  launchChantierFromCommercial,
  launchChantierSchema,
} from "@/lib/chantiers/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANTIERS_RESOURCE = { resource_type: "CHANTIER" as const, resource_id: "registry" };
const COMMERCIAL_RESOURCE = { resource_type: "COMMERCIAL" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusFor(code: string): number {
  if (code === "CHANTIERS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("ALREADY") || code.includes("CONFLICT")) return 409;
  return 400;
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  const startedAt = Date.now();
  let desktop: ReturnType<typeof createDesktopSharedResourceRuntime> | null = null;
  let ownsLock = false;
  let stage = "parse-request";

  try {
    const input = launchChantierSchema.parse(await request.json());
    stage = "create-runtime";
    desktop = createDesktopSharedResourceRuntime();
    const actor = { userId: desktop.owner.userId, displayName: desktop.owner.displayName };
    if (!chantierCapabilities(actor).canLaunch) throw new Error("CHANTIER_LAUNCH_FORBIDDEN");

    stage = "read-commercial-and-lock-chantiers";
    const [commercialResource, lock, openedInitial] = await Promise.all([
      desktop.states.get(COMMERCIAL_RESOURCE),
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

    const commercial = parseCommercialPayload(commercialResource?.payload);
    const commercialCase = commercial.cases.find((item) => item.id === input.commercialCaseId);
    if (!commercialCase) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");

    let opened = openedInitial;
    stage = "apply-launch";
    let mutation = launchChantierFromCommercial(
      parseChantiersPayload(opened.resource?.payload),
      commercialCase,
      input,
      actor,
    );

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
      mutation = launchChantierFromCommercial(
        parseChantiersPayload(opened.resource?.payload),
        commercialCase,
        input,
        actor,
      );
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
    console.info("[PAPOT][Chantiers] launch saved", { ms: Date.now() - startedAt });
    return noStoreJson({
      payload,
      actor,
      capabilities: chantierCapabilities(actor),
      focusChantierId: mutation.focusChantierId,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "CHANTIER_LAUNCH_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "CHANTIER_LAUNCH_FAILED";
    console.error("[PAPOT][Chantiers] launch failed", { stage, code, ms: Date.now() - startedAt });
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
