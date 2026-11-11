import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { buildEntriesActor } from "@/lib/entries/actor";
import { desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { createEntriesRepository } from "@/lib/entries/create-repository";
import type { EntriesPayload } from "@/lib/entries/domain";
import {
  entriesCapabilities,
  entriesMutationSchema,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function publicSnapshot(contenu: EntriesPayload, auteur: EntriesActor, focusEntryId?: string) {
  return {
    payload: contenu,
    actor: { userId: auteur.userId, displayName: auteur.displayName },
    capabilities: entriesCapabilities(auteur),
    suggestedAssignees: listSuggestedAssignees(contenu, auteur),
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
    const contexte = await requireModuleRequestContext("capture", "READ");
    const auteur = await buildEntriesActor(contexte);
    const repository = await createEntriesRepository();
    const contenu = await repository.load();
    return noStoreJson(publicSnapshot(contenu, auteur));
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "ENTRIES_LOAD_FAILED";
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}

export async function POST(requete: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const saisie = entriesMutationSchema.parse(await requete.json());
    stage = "create-context";
    const contexte = await requireModuleRequestContext("capture", "WRITE");
    const auteur = await buildEntriesActor(contexte);
    const repository = await createEntriesRepository();

    stage = "mutate-repository";
    const mutation = await repository.mutate(saisie, auteur);

    console.info("[PAPOT][Entries] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(publicSnapshot(mutation.payload, auteur, mutation.focusEntryId));
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "ENTRIES_MUTATION_FAILED";
    console.error("[PAPOT][Entries] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ status: "error", error: code }, { status: errorStatus(code) });
  }
}
