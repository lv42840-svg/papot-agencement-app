import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
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
  rawText: z.string().trim().min(1).max(4000),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  tagIds: z.array(z.string().min(1).max(100)).max(12).default([]),
  clientId: z.string().uuid().nullable().optional(),
  commercialCaseId: z.string().uuid().nullable().optional(),
  files: z.array(fileSchema).max(12).default([]),
});

function actorFor(context: Awaited<ReturnType<typeof requireModuleRequestContext>>): EntriesActor {
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    canQualify: context.moduleAccess.canWrite,
    canManageTags: context.user.canManagePermissions,
  };
}

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

function decodeFiles(
  files: Array<{ name: string; type: string; base64: string }>,
): File[] {
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
    const actor = actorFor(context);
    const repository = await createEntriesRepository();

    const parsed = captureSchema.parse(await request.json());
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

    const entryId = randomUUID();
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

    if (!transport || files.length === 0) {
      return NextResponse.json(snapshot(created.payload, actor, created.focusEntryId), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    uploaded = await uploadEntryAttachments(transport, entryId, files);
    const mutation = await repository.registerAttachments(entryId, uploaded, actor);

    return NextResponse.json(snapshot(mutation.payload, actor, mutation.focusEntryId), {
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
      { status: code.endsWith("_NOT_FOUND") ? 404 : 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
