import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { listEntryAssigneeNames } from "@/lib/entries/assignees";
import { createEntriesRepository } from "@/lib/entries/create-repository";
import type { EntriesPayload } from "@/lib/entries/domain";
import {
  entriesCapabilities,
  entriesMutationSchema,
  type EntriesActor,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function actorFor(context: Awaited<ReturnType<typeof requireModuleRequestContext>>): EntriesActor {
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    canQualify: context.moduleAccess.canWrite,
    canManageTags: context.user.canManagePermissions,
  };
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function publicSnapshot(payload: EntriesPayload, actor: EntriesActor, focusEntryId?: string) {
  return {
    payload,
    actor: { userId: actor.userId, displayName: actor.displayName },
    capabilities: entriesCapabilities(actor),
    suggestedAssignees: await listEntryAssigneeNames(payload, actor),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code.endsWith("_FORBIDDEN") || code === "ENTRY_NOT_ASSIGNED_TO_ACTOR") return 403;
  if (code === "ENTRIES_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("CONFLICT") || code.startsWith("ENTRY_NOT_")) return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireModuleRequestContext("capture", "READ");
    const actor = actorFor(context);
    const repository = await createEntriesRepository();
    const payload = await repository.load();
    return noStoreJson(await publicSnapshot(payload, actor));
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRIES_LOAD_FAILED";
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const input = entriesMutationSchema.parse(await request.json());
    stage = "create-context";
    const context = await requireModuleRequestContext("capture", "WRITE");
    const actor = actorFor(context);
    const repository = await createEntriesRepository();

    stage = "mutate-repository";
    const mutation = await repository.mutate(input, actor);

    console.info("[PAPOT][Entries] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(await publicSnapshot(mutation.payload, actor, mutation.focusEntryId));
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "ENTRIES_MUTATION_FAILED";
    console.error("[PAPOT][Entries] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}
