import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { hasModuleAccess, type AccessLevel } from "@/lib/auth/permissions";
import {
  entriesCapabilities,
  entriesMutationSchema,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";
import {
  applyEntriesMutationInDatabase,
  loadEntriesPayloadFromDatabase,
} from "@/lib/entries/postgres-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EntriesContext = {
  actor: EntriesActor;
};

async function requireEntriesContext(required: AccessLevel): Promise<EntriesContext> {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");

  const isAdmin = user.canManagePermissions;
  const canWrite = isAdmin || (await hasModuleAccess(user.id, "capture", "WRITE"));
  const canRead = canWrite || isAdmin || (await hasModuleAccess(user.id, "capture", "READ"));
  if (required === "WRITE" ? !canWrite : !canRead) throw new Error("MODULE_FORBIDDEN");

  return {
    actor: {
      userId: user.id,
      displayName: user.displayName,
      canQualify: canWrite,
      canManageTags: user.canManagePermissions,
    },
  };
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(
  payload: Awaited<ReturnType<typeof loadEntriesPayloadFromDatabase>>,
  actor: EntriesActor,
  focusEntryId?: string,
) {
  return {
    payload,
    actor: { userId: actor.userId, displayName: actor.displayName },
    capabilities: entriesCapabilities(actor),
    suggestedAssignees: listSuggestedAssignees(payload, actor),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function errorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "MODULE_FORBIDDEN" || code.endsWith("_FORBIDDEN")) return 403;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (
    code.includes("AMBIGUOUS") ||
    code.includes("CONFLICT") ||
    code.startsWith("ENTRY_NOT_") ||
    code === "ENTRY_TAG_ID_INVALID"
  ) {
    return 409;
  }
  return 400;
}

export async function GET() {
  try {
    const { actor } = await requireEntriesContext("READ");
    const payload = await loadEntriesPayloadFromDatabase();
    return noStoreJson(publicSnapshot(payload, actor));
  } catch (error) {
    const code = error instanceof Error ? error.message : "ENTRIES_LOAD_FAILED";
    console.error("[PAPOT][Entries] PostgreSQL load failed", { code });
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const input = entriesMutationSchema.parse(await request.json());
    const { actor } = await requireEntriesContext("WRITE");
    const mutation = await applyEntriesMutationInDatabase(input, actor);

    console.info("[PAPOT][Entries] PostgreSQL mutation saved", {
      action: input.action,
      ms: Date.now() - startedAt,
    });
    return noStoreJson(publicSnapshot(mutation.payload, actor, mutation.focusEntryId));
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "ENTRIES_MUTATION_FAILED";
    console.error("[PAPOT][Entries] PostgreSQL mutation failed", {
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}
