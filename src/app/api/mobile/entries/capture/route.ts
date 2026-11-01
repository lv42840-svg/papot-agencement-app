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

function snapshot(payload: EntriesPayload, actor: EntriesActor, focusEntryId?: string) {
  return {
    payload,
    actor: { userId: actor.userId, displayName: actor.displayName },
    capabilities: entriesCapabilities(actor),
    suggestedAssignees: listSuggestedAssignees(payload, actor),
    focusEntryId,
    serverNow: new Date().toISOString(),
  };
}

function decodeFiles(files: Array<{ name: string; type: string; base64: string }>): File[] {
  return files.map((item) => {
    const bytes = Buffer.from(item.base64, "base64");
    return new File([bytes], item.name, {
      type: item.type || "application/octet-stream",
    });
  });
}

export async function POST(request: Request) {
  let uploaded = [] as Awaited<ReturnType<typeof uploadEntryAttachments>>;
  let transport: EntryAttachmentTransport | null = null;

  try {
    const context = await requireModuleRequestContext("capture", "WRITE");
    const actor = await buildEntriesActor(context);
    const repository = await createEntriesRepository();

    const parsed = captureSchema.parse(await request.json());
    if (parsed.ownerUserId !== context.user.id) throw new Error("CAPTURE_OWNER_FORBIDDEN");
    const digest = createHash("sha256")
      .update(context.user.id + ":" + parsed.requestId)
      .digest("hex");
    const entryId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const files = decodeFiles(parsed.files);

    let clientId = parsed.clientId ?? null;
    const commercialCaseId = parsed.commercialCaseId ?? null;

    if (clientId || commercialCaseId) {
      const [clientsPayload, commercialPayload] = await Promise.all([
        createClientsRepository().then((clients) => clients.load()),
        createCommercialRepository().load(),
      ]);

      if (clientId) {
        const client = clientsPayload.clients.find(
          (candidate) => candidate.id === clientId && !candidate.isArchived,
        );
        if (!client) throw new Error("CLIENT_NOT_FOUND");
      }

      if (commercialCaseId) {
        const commercialCase = commercialPayload.cases.find(
          (candidate) => candidate.id === commercialCaseId && !isCommercialClosed(candidate),
        );
        if (!commercialCase) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        if (commercialCase.clientId) clientId = commercialCase.clientId;
      }
    }

    if (files.length > 0) {
      transport = await createEntryAttachmentTransport({
        owner: { displayName: context.user.displayName },
      });
    }

    if (transport && files.length > 0)
      uploaded = await uploadEntryAttachments(transport, entryId, files);
    const mutation = await withBusinessTransaction(async () => {
      const created = await repository.mutate(
        {
          action: "create",
          entryId,
          rawText: parsed.rawText,
          priority: parsed.priority,
          tagIds: parsed.tagIds,
          clientId,
          commercialCaseId,
        },
        actor,
      );
      const existing = created.payload.entries.find((entry) => entry.id === entryId)!;
      if (existing.attachments.length > 0 || uploaded.length === 0) return created;
      return repository.registerAttachments(entryId, uploaded, actor);
    });
    // Another retry may already have committed attachments; remove only our unused files.
    const used = new Set(
      mutation.payload.entries
        .find((entry) => entry.id === entryId)!
        .attachments.map((file) => file.id),
    );
    if (transport)
      await cleanupEntryAttachments(
        transport,
        uploaded.filter((file) => !used.has(file.id)),
      );
    uploaded = [];
    return NextResponse.json(snapshot(mutation.payload, actor, entryId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (transport && uploaded.length > 0) await cleanupEntryAttachments(transport, uploaded);

    const code =
      error instanceof z.ZodError
        ? "ENTRIES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
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
