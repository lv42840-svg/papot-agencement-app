import { withBusinessTransaction } from "@/lib/server-db/business-transaction";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { buildEntriesActor } from "@/lib/entries/actor";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
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

const fileSchema = z.object({
  name: z.string().trim().min(1).max(180),
  type: z.string().trim().max(200).default("application/octet-stream"),
  base64: z.string().min(1),
});

const captureSchema = z.object({
  requestId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  rawText: z.string().trim().min(1).max(4000),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  tagIds: z.array(z.string().min(1).max(100)).max(12).default([]),
  clientId: z.string().uuid().nullable().optional(),
  commercialCaseId: z.string().uuid().nullable().optional(),
  files: z.array(fileSchema).max(12).default([]),
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

function decodeFiles(fichiers: Array<{ name: string; type: string; base64: string }>): File[] {
  return fichiers.map((element) => {
    const bytes = Buffer.from(element.base64, "base64");
    return new File([bytes], element.name, {
      type: element.type || "application/octet-stream",
    });
  });
}

export async function POST(requete: Request) {
  let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
  let transport: EntryAttachmentTransport | null = null;

  try {
    const contexte = await requireModuleRequestContext("capture", "WRITE");
    const auteur = await buildEntriesActor(contexte);
    const repository = await createEntriesRepository();

    const analyse = captureSchema.parse(await requete.json());
    if (analyse.ownerUserId !== contexte.user.id) throw new Error("CAPTURE_OWNER_FORBIDDEN");
    const digest = createHash("sha256")
      .update(contexte.user.id + ":" + analyse.requestId)
      .digest("hex");
    const idEntree = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const fichiers = decodeFiles(analyse.files);

    let idClient = analyse.clientId ?? null;
    const commercialCaseId = analyse.commercialCaseId ?? null;

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

    if (transport && fichiers.length > 0)
      uploaded = await uploadEntryAttachments(transport, idEntree, fichiers);
    const mutation = await withBusinessTransaction(async () => {
      const created = await repository.mutate(
        {
          action: "create",
          entryId: idEntree,
          rawText: analyse.rawText,
          priority: analyse.priority,
          tagIds: analyse.tagIds,
          clientId: idClient,
          commercialCaseId,
        },
        auteur,
      );
      const existing = created.payload.entries.find((entree) => entree.id === idEntree)!;
      if (existing.attachments.length > 0 || uploaded.length === 0) return created;
      return repository.registerAttachments(idEntree, uploaded, auteur);
    });
    // Another retry may already have committed attachments; remove only our unused files.
    const used = new Set(
      mutation.payload.entries
        .find((entree) => entree.id === idEntree)!
        .attachments.map((fichier) => fichier.id),
    );
    if (transport)
      await cleanupEntryAttachments(
        transport,
        uploaded.filter((fichier) => !used.has(fichier.id)),
      );
    uploaded = [];
    return NextResponse.json(snapshot(mutation.payload, auteur, idEntree), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erreur) {
    if (transport && uploaded.length > 0) await cleanupEntryAttachments(transport, uploaded);

    const code =
      erreur instanceof z.ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "ENTRIES_CAPTURE_FAILED";

    return NextResponse.json(
      { error: code },
      {
        status: code.endsWith("_FORBIDDEN") ? 403 : code.endsWith("_NOT_FOUND") ? 404 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
