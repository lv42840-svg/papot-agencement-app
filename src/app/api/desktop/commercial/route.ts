import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import {
  applyCommercialMutationInDatabase,
  commercialPostgresMutationSchema,
  listActiveCommercialUsers,
  loadCommercialPayloadFromDatabase,
} from "@/lib/commercial/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusFor(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "MODULE_FORBIDDEN") return 403;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("CLOSED") || code.includes("ALREADY_LINKED")) return 409;
  return 400;
}

async function snapshot(canWrite: boolean, actor: { userId: string; displayName: string }, focusCaseId?: string) {
  const [payload, activeUsers] = await Promise.all([
    loadCommercialPayloadFromDatabase(),
    listActiveCommercialUsers(),
  ]);
  return {
    payload,
    actor,
    capabilities: {
      canCreate: canWrite,
      canRead: true,
      canModify: canWrite,
      canConfirm: canWrite,
    },
    suggestedPeople: activeUsers.map((user) => user.displayName),
    activeUsers,
    focusCaseId,
    serverNow: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("commercial", "READ");
    const actor = { userId: context.user.id, displayName: context.user.displayName };
    return noStoreJson(await snapshot(context.moduleAccess.canWrite, actor));
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const input = commercialPostgresMutationSchema.parse(await request.json());
    const context = await requireDesktopRequestContext("commercial", "WRITE");
    const actor = { userId: context.user.id, displayName: context.user.displayName };
    const mutation = await applyCommercialMutationInDatabase(input, actor);
    console.info("[PAPOT][Commercial] PostgreSQL mutation saved", {
      action: input.action,
      ms: Date.now() - startedAt,
    });
    return noStoreJson(await snapshot(true, actor, mutation.focusCaseId));
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "COMMERCIAL_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "COMMERCIAL_MUTATION_FAILED";
    console.error("[PAPOT][Commercial] PostgreSQL mutation failed", {
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}
