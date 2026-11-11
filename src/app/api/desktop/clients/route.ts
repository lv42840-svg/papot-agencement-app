import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { ClientsPayload } from "@/lib/clients/domain";
import { clientsMutationSchema } from "@/lib/clients/mutations";
import { ClientsRepositoryError } from "@/lib/clients/repository";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { desktopRequestErrorStatus } from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function publicSnapshot(contenu: ClientsPayload, canWrite: boolean, focusClientId?: string) {
  return { payload: contenu, canWrite, focusClientId };
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
    const contexte = await requireModuleRequestContext("clients", "READ");
    const repository = await createClientsRepository();
    const contenu = await repository.load();
    return noStoreJson(publicSnapshot(contenu, contexte.moduleAccess.canWrite));
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "CLIENTS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

export async function POST(requete: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const saisie = clientsMutationSchema.parse(await requete.json());
    stage = "create-repository";
    const contexte = await requireModuleRequestContext("clients", "WRITE");
    const repository = await createClientsRepository();

    stage = "mutate";
    const mutation = await repository.mutate(saisie, {
      userId: contexte.user.id,
      displayName: contexte.user.displayName,
    });

    console.info("[PAPOT][Clients] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      publicSnapshot(mutation.payload, contexte.moduleAccess.canWrite, mutation.focusClientId),
    );
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "CLIENTS_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "CLIENTS_MUTATION_FAILED";
    console.error("[PAPOT][Clients] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });

    const corps =
      erreur instanceof ClientsRepositoryError && erreur.details?.lockedBy
        ? { error: code, lockedBy: erreur.details.lockedBy }
        : { error: code };
    return noStoreJson(corps, { status: errorStatus(code) });
  }
}
