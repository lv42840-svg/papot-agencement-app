import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { loadCommercialCaseFromDatabase } from "@/lib/commercial/postgres";
import { parseChantiersPayload } from "@/lib/chantiers/domain";
import { chantierCapabilities } from "@/lib/chantiers/mutations";
import {
  launchChantierFromAffair,
  launchChantierFromAffairSchema,
} from "@/lib/chantiers/launch-from-affair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANTIERS_RESOURCE = { resource_type: "CHANTIER" as const, resource_id: "registry" };
const LOCK_TTL_MS = 30_000;

type Owner = { userId: string; deviceId: string; displayName: string };

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "CHANTIERS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (code.includes("ALREADY") || code.includes("CONFLICT")) return 409;
  return 400;
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  const startedAt = Date.now();
  let desktop: ReturnType<typeof createDesktopSharedResourceRuntime> | null = null;
  let owner: Owner | null = null;
  let ownsLock = false;
  let stage = "parse-request";

  try {
    const input = launchChantierFromAffairSchema.parse(await request.json());
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("chantiers", "WRITE");
    await requireSpecialPermission(context.user, "commercial.confirm_launch");
    desktop = context.desktop;
    owner = context.owner;
    const actor = { userId: owner.userId, displayName: owner.displayName };

    stage = "read-affair-and-lock-chantiers";
    const [affair, lock, openedInitial] = await Promise.all([
      loadCommercialCaseFromDatabase(input.commercialCaseId),
      desktop.locks.acquire({
        resource: CHANTIERS_RESOURCE,
        leaseId,
        owner,
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
    if (!affair) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");

    let opened = openedInitial;
    stage = "apply-launch";
    let mutation = launchChantierFromAffair(
      parseChantiersPayload(opened.resource?.payload),
      affair,
      input,
      actor,
    );

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: CHANTIERS_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(CHANTIERS_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = launchChantierFromAffair(
        parseChantiersPayload(opened.resource?.payload),
        affair,
        input,
        actor,
      );
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: CHANTIERS_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }

    if (saved.status === "conflict") throw new Error("CHANTIERS_VERSION_CONFLICT");
    const payload = parseChantiersPayload(saved.resource.payload);
    console.info("[PAPOT][Chantiers] launch from affair saved", { ms: Date.now() - startedAt });
    return noStoreJson({
      payload,
      actor,
      capabilities: {
        ...chantierCapabilities(actor),
        canRead: true,
        canModify: true,
        canLaunch: true,
        canArchive: true,
      },
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
    if (desktop && owner && ownsLock) {
      const releaseDesktop = desktop;
      const releaseOwner = owner;
      void releaseDesktop.locks
        .release({ resource: CHANTIERS_RESOURCE, leaseId, owner: releaseOwner })
        .catch(() => undefined);
    }
  }
}
