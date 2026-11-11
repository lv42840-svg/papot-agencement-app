import { NextResponse } from "next/server";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { buildEntriesActor } from "@/lib/entries/actor";
import { desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { createEntryAttachmentTransport } from "@/lib/entries/attachment-file-runtime";
import { cleanupEntryAttachments, uploadEntryAttachments } from "@/lib/entries/attachment-storage";
import { createEntriesRepository } from "@/lib/entries/create-repository";
import type { EntriesPayload } from "@/lib/entries/domain";
import {
  entriesCapabilities,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ entryId: string }> };

function snapshot(contenu: EntriesPayload, auteur: EntriesActor, focusEntryId?: string) {
  return {
    payload: contenu,
    actor: { userId: auteur.userId, displayName: auteur.displayName },
    capabilities: entriesCapabilities(auteur),
    suggestedAssignees: listSuggestedAssignees(contenu, auteur),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "ENTRY_NOT_FOUND") return 404;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (code.includes("INTEGRITY") || code.includes("CUTOVER_VALIDATION")) return 500;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("TOO_LARGE")) return 413;
  return 400;
}

export async function POST(requete: Request, contexte: RouteContext) {
  try {
    const { entryId: idEntree } = await contexte.params;
    const requestContext = await requireModuleRequestContext("capture", "WRITE");
    const auteur = await buildEntriesActor(requestContext);
    const repository = await createEntriesRepository();
    const form = await requete.formData();
    const fichiers = form
      .getAll("files")
      .filter((valeur): valeur is File => valeur instanceof File);
    if (fichiers.length === 0) {
      return NextResponse.json({ error: "ENTRY_ATTACHMENTS_REQUIRED" }, { status: 400 });
    }

    const currentPayload = await repository.load();
    if (!currentPayload.entries.some((entree) => entree.id === idEntree)) {
      return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    }

    const transport = await createEntryAttachmentTransport({
      owner: { displayName: requestContext.user.displayName },
    });
    let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
    try {
      uploaded = await uploadEntryAttachments(transport, idEntree, fichiers);
      const mutation = await repository.registerAttachments(idEntree, uploaded, auteur);
      return NextResponse.json(snapshot(mutation.payload, auteur, mutation.focusEntryId), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (erreur) {
      if (uploaded.length > 0) await cleanupEntryAttachments(transport, uploaded);
      throw erreur;
    }
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "ENTRY_ATTACHMENTS_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
