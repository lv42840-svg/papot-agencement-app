import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { parseClientsPayload } from "@/lib/clients/domain";
import { applyClientsMutation, clientsMutationSchema } from "@/lib/clients/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENTS_RESOURCE = {
  resource_type: "CLIENTS" as const,
  resource_id: "global",
};
const CLIENTS_WRITE_LOCK_TTL_MS = 30_000;
const CLIENTS_OWN_LOCK_RECLAIM_AFTER_MS = 0;

type Owner = { userId: string; deviceId: string; displayName: string };

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(
  payload: ReturnType<typeof parseClientsPayload>,
  canWrite: boolean,
  focusClientId?: string,
) {
  return { payload, canWrite, focusClientId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "CLIENTS_LOCKED") return 423;
  if (code === "CLIENT_NOT_FOUND") return 404;
  if (code === "CLIENT_SIRET_EXISTS" || code === "CLIENTS_VERSION_CONFLICT") return 409;
  if (code === "CLIENT_ARCHIVED") return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("clients", "READ");
    const cached = context.desktop.states.getCached(CLIENTS_RESOURCE);

    if (cached !== undefined) {
      void context.desktop.states.get(CLIENTS_RESOURCE).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "CLIENTS_REFRESH_FAILED";
        console.error("[PAPOT][Clients] background refresh failed", { code });
      });
      return noStoreJson(publicSnapshot(parseClientsPayload(cached?.payload), context.moduleAccess.canWrite));
    }

    const resource = await context.desktop.states.get(CLIENTS_RESOURCE);
    return noStoreJson(
      publicSnapshot(parseClientsPayload(resource?.payload), context.moduleAccess.canWrite),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLIENTS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
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
    const input = clientsMutationSchema.parse(await request.json());
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("clients", "WRITE");
    desktop = context.desktop;
    owner = context.owner;

    stage = "acquire-lock-and-open-resource";
    const [lockResult, initialOpened] = await Promise.all([
      desktop.locks.acquire({
        resource: CLIENTS_RESOURCE,
        leaseId,
        owner,
        baseVersion: 0,
        ttlMs: CLIENTS_WRITE_LOCK_TTL_MS,
        reclaimOwnAfterMs: CLIENTS_OWN_LOCK_RECLAIM_AFTER_MS,
      }),
      desktop.states.openForUpdate(CLIENTS_RESOURCE),
    ]);

    if (lockResult.status === "locked") {
      return noStoreJson(
        {
          error: "CLIENTS_LOCKED",
          lockedBy: lockResult.lock.owner_display_name,
        },
        { status: 423 },
      );
    }
    ownsLock = true;

    let opened = initialOpened;
    stage = "apply-mutation";
    let mutation = applyClientsMutation(
      parseClientsPayload(opened.resource?.payload),
      input,
      { userId: context.user.id, displayName: context.user.displayName },
    );

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: CLIENTS_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(CLIENTS_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = applyClientsMutation(
        parseClientsPayload(opened.resource?.payload),
        input,
        { userId: context.user.id, displayName: context.user.displayName },
      );
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: CLIENTS_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }

    if (saved.status === "conflict") {
      return noStoreJson({ error: "CLIENTS_VERSION_CONFLICT" }, { status: 409 });
    }

    console.info("[PAPOT][Clients] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      publicSnapshot(
        parseClientsPayload(saved.resource.payload),
        context.moduleAccess.canWrite,
        mutation.focusClientId,
      ),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "CLIENTS_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "CLIENTS_MUTATION_FAILED";
    console.error("[PAPOT][Clients] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  } finally {
    if (desktop && owner && ownsLock) {
      const releaseDesktop = desktop;
      const releaseOwner = owner;
      void releaseDesktop.locks
        .release({ resource: CLIENTS_RESOURCE, leaseId, owner: releaseOwner })
        .catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
          console.error("[PAPOT][Clients] lock release failed", { code });
        });
    }
  }
}
