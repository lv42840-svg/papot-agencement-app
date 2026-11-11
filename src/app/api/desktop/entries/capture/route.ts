import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { buildEntriesActor } from "@/lib/entries/actor";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
import { desktopRequestErrorStatus } from "@/lib/desktop/request-context";
import { createEntryAttachmentTransport } from "@/lib/entries/attachment-file-runtime";
import {
  cleanupEntryAttachments,
  uploadEntryAttachments,
  type EntryAttachmentTransport,
} from "@/lib/entries/attachment-storage";
import { createEntriesRepository } from "@/lib/entries/create-repository";
import {
  entriesCapabilities,
  listSuggestedAssignees,
  type EntriesActor,
} from "@/lib/entries/mutations";
import type { EntriesPayload } from "@/lib/entries/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const captureSchema = z.object({
  rawText: z.string().trim().min(1).max(4000),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  tagIds: z.array(z.string().min(1).max(100)).max(12).default([]),
  clientId: z.string().uuid().nullable().optional(),
  commercialCaseId: z.string().uuid().nullable().optional(),
});

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
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (code.includes("INTEGRITY") || code.includes("CUTOVER_VALIDATION")) return 500;
  if (code.includes("TOO_LARGE")) return 413;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.includes("CONFLICT")) return 409;
  return 400;
}

export async function POST(requete: Request) {
  let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
  let transport: EntryAttachmentTransport | null = null;

  try {
    const contexte = await requireModuleRequestContext("capture", "WRITE");
    const auteur = await buildEntriesActor(contexte);
    const repository = await createEntriesRepository();
    const form = await requete.formData();
    const fichiers = form
      .getAll("files")
      .filter((valeur): valeur is File => valeur instanceof File);

    let rawTagIds: unknown = [];
    try {
      rawTagIds = JSON.parse(String(form.get("tagIds") ?? "[]"));
    } catch {
      return NextResponse.json({ error: "ENTRIES_REQUEST_INVALID" }, { status: 400 });
    }

    const rawClientId = String(form.get("clientId") ?? "").trim();
    const rawCommercialCaseId = String(form.get("commercialCaseId") ?? "").trim();
    const analyse = captureSchema.safeParse({
      rawText: String(form.get("rawText") ?? ""),
      priority: String(form.get("priority") ?? "NORMAL"),
      tagIds: rawTagIds,
      clientId: rawClientId || null,
      commercialCaseId: rawCommercialCaseId || null,
    });
    if (!analyse.success) {
      return NextResponse.json({ error: "ENTRIES_REQUEST_INVALID" }, { status: 400 });
    }

    let idClient = analyse.data.clientId ?? null;
    const commercialCaseId = analyse.data.commercialCaseId ?? null;

    if (idClient || commercialCaseId) {
      const [clientsPayload, commercialPayload] = await Promise.all([
        createClientsRepository().then((clients) => clients.load()),
        createCommercialRepository().load(),
      ]);

      if (idClient) {
        const client = clientsPayload.clients.find(
          (candidat) => candidat.id === idClient && !candidat.isArchived,
        );
        if (!client) throw new Error("CLIENT_NOT_FOUND");
      }

      if (commercialCaseId) {
        const commercialCase = commercialPayload.cases.find(
          (candidat) => candidat.id === commercialCaseId && !isCommercialClosed(candidat),
        );
        if (!commercialCase) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        if (commercialCase.clientId) idClient = commercialCase.clientId;
      }
    }

    if (fichiers.length > 0) {
      transport = await createEntryAttachmentTransport({
        owner: { displayName: contexte.user.displayName },
      });
    }

    const idEntree = randomUUID();
    const created = await repository.mutate(
      {
        action: "create",
        entryId: idEntree,
        ...analyse.data,
        clientId: idClient,
        commercialCaseId,
      },
      auteur,
    );

    if (!transport || fichiers.length === 0) {
      return NextResponse.json(snapshot(created.payload, auteur, created.focusEntryId), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    uploaded = await uploadEntryAttachments(transport, idEntree, fichiers);
    const mutation = await repository.registerAttachments(idEntree, uploaded, auteur);
    return NextResponse.json(snapshot(mutation.payload, auteur, mutation.focusEntryId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erreur) {
    if (transport && uploaded.length > 0) await cleanupEntryAttachments(transport, uploaded);
    const code = erreur instanceof Error ? erreur.message : "ENTRIES_CAPTURE_FAILED";
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
