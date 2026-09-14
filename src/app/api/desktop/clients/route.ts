import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { ClientsPayload } from "@/lib/clients/domain";
import { clientsMutationSchema } from "@/lib/clients/mutations";
import { ClientsRepositoryError } from "@/lib/clients/repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(payload: ClientsPayload, canWrite: boolean, focusClientId?: string) {
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
    const repository = createClientsRepository(context);
    const payload = await repository.load();
    return noStoreJson(publicSnapshot(payload, context.moduleAccess.canWrite));
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLIENTS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const input = clientsMutationSchema.parse(await request.json());
    stage = "create-repository";
    const context = await requireDesktopRequestContext("clients", "WRITE");
    const repository = createClientsRepository(context);

    stage = "mutate";
    const mutation = await repository.mutate(input, {
      userId: context.user.id,
      displayName: context.user.displayName,
    });

    console.info("[PAPOT][Clients] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      publicSnapshot(mutation.payload, context.moduleAccess.canWrite, mutation.focusClientId),
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

    const body =
      error instanceof ClientsRepositoryError && error.details?.lockedBy
        ? { error: code, lockedBy: error.details.lockedBy }
        : { error: code };
    return noStoreJson(body, { status: errorStatus(code) });
  }
}
