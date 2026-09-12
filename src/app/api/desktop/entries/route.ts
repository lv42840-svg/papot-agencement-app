import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { parseEntriesPayload } from "@/lib/entries/domain";
import {
  applyEntriesMutation,
  entriesCapabilities,
  entriesMutationSchema,
  listSuggestedAssignees,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRIES_RESOURCE = {
  resource_type: "ENTRIES" as const,
  resource_id: "global",
};

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(
  payload: ReturnType<typeof parseEntriesPayload>,
  owner: { userId: string; displayName: string },
  focusEntryId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  return {
    payload,
    actor,
    capabilities: entriesCapabilities(actor),
    suggestedAssignees: listSuggestedAssignees(payload, actor),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function errorStatus(code: string): number {
  if (code.endsWith("_FORBIDDEN") || code === "ENTRY_NOT_ASSIGNED_TO_ACTOR") return 403;
  if (code === "ENTRIES_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("CONFLICT") || code.startsWith("ENTRY_NOT_")) return 409;
  return 400;
}

export async function GET() {
  const leaseId = randomUUID();
  try {
    const desktop = createDesktopSharedResourceRuntime();
    const opened = await desktop.coordinator.open({
      resource: ENTRIES_RESOURCE,
      leaseId,
      owner: desktop.owner,
    });
    const payload = parseEntriesPayload(opened.resource?.payload);

    if (opened.status === "editable") {
      try {
        await desktop.coordinator.release({
          resource: ENTRIES_RESOURCE,
          leaseId,
          owner: desktop.owner,
        });
      } catch {
        // La lecture reste valable. Le lease expirera si sa libération est momentanément impossible.
      }
    }

    return noStoreJson(publicSnapshot(payload, desktop.owner));
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRIES_LOAD_FAILED";
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  let desktop: ReturnType<typeof createDesktopSharedResourceRuntime> | null = null;
  let ownsLock = false;

  try {
    const input = entriesMutationSchema.parse(await request.json());
    desktop = createDesktopSharedResourceRuntime();
    const opened = await desktop.coordinator.open({
      resource: ENTRIES_RESOURCE,
      leaseId,
      owner: desktop.owner,
    });

    if (opened.status === "read-only") {
      return noStoreJson(
        {
          status: "error",
          error: "ENTRIES_LOCKED",
          lockedBy: opened.lock.owner_display_name,
        },
        { status: 423 },
      );
    }
    ownsLock = true;

    const current = parseEntriesPayload(opened.resource?.payload);
    const actor = { userId: desktop.owner.userId, displayName: desktop.owner.displayName };
    const mutation = applyEntriesMutation(current, input, actor);
    const saved = await desktop.coordinator.save({
      resource: ENTRIES_RESOURCE,
      leaseId,
      owner: desktop.owner,
      expectedVersion: opened.baseVersion,
      payload: mutation.payload,
    });

    if (saved.status === "conflict") {
      return noStoreJson(
        { status: "error", error: "ENTRIES_VERSION_CONFLICT" },
        { status: 409 },
      );
    }

    return noStoreJson(
      publicSnapshot(
        parseEntriesPayload(saved.resource.payload),
        desktop.owner,
        mutation.focusEntryId,
      ),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "ENTRIES_MUTATION_FAILED";
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  } finally {
    if (desktop && ownsLock) {
      try {
        await desktop.coordinator.release({
          resource: ENTRIES_RESOURCE,
          leaseId,
          owner: desktop.owner,
        });
      } catch {
        // Le lease expirera de lui-même si Nextcloud devient indisponible pendant la libération.
      }
    }
  }
}
