import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { EntryAttachment } from "./domain";
import type { NextcloudDavClient } from "@/lib/sync/nextcloud-dav";

export const MAX_ENTRY_ATTACHMENTS_PER_UPLOAD = 12;
export const MAX_ENTRY_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type EntryAttachmentTransport = {
  dav: NextcloudDavClient;
  nextcloudUserId: string;
  syncRoot: string;
  displayName: string;
};

function safeFileName(value: string): string {
  const trimmed = value.trim().replace(/[\\/\0]/g, "-");
  return (trimmed || "piece-jointe").slice(0, 180);
}

function validateFiles(files: File[]): void {
  if (files.length > MAX_ENTRY_ATTACHMENTS_PER_UPLOAD) {
    throw new Error("ENTRY_ATTACHMENTS_TOO_MANY");
  }
  for (const file of files) {
    if (file.size > MAX_ENTRY_ATTACHMENT_BYTES) {
      throw new Error("ENTRY_ATTACHMENT_TOO_LARGE");
    }
    if (!file.name.trim()) throw new Error("ENTRY_ATTACHMENT_NAME_REQUIRED");
  }
}

async function entryAttachmentRoot(
  transport: EntryAttachmentTransport,
  entryId: string,
  attachmentId?: string,
): Promise<string> {
  const filesRoot = transport.dav.filesRoot(transport.nextcloudUserId);
  const segments = [transport.syncRoot, "documents", "entries", entryId];
  if (attachmentId) segments.push(attachmentId);
  return transport.dav.ensurePath(filesRoot, segments);
}

async function deleteAttachmentCollection(
  transport: EntryAttachmentTransport,
  entryId: string,
  attachmentId: string,
): Promise<void> {
  const collection = await entryAttachmentRoot(transport, entryId, attachmentId);
  await transport.dav.delete(collection, true);
}

export async function uploadEntryAttachments(
  transport: EntryAttachmentTransport,
  entryId: string,
  files: File[],
  now = new Date(),
): Promise<EntryAttachment[]> {
  validateFiles(files);
  const uploaded: EntryAttachment[] = [];

  try {
    for (const file of files) {
      const id = randomUUID();
      const objectName = safeFileName(file.name);
      const collection = await entryAttachmentRoot(transport, entryId, id);
      const url = transport.dav.childUrl(collection, objectName);
      const bytes = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");

      try {
        await transport.dav.putBytes(url, bytes, file.type || "application/octet-stream");
      } catch (error) {
        await transport.dav.delete(collection, true).catch(() => undefined);
        throw error;
      }

      uploaded.push({
        id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        sha256,
        storagePath: `documents/entries/${entryId}/${id}/${objectName}`,
        uploadedAt: now.toISOString(),
        uploadedByName: transport.displayName,
      });
    }

    return uploaded;
  } catch (error) {
    await Promise.all(
      uploaded.map((attachment) =>
        deleteAttachmentCollection(transport, entryId, attachment.id).catch(() => undefined),
      ),
    );
    throw error;
  }
}

export function attachmentUrl(
  transport: Pick<EntryAttachmentTransport, "dav" | "nextcloudUserId" | "syncRoot">,
  attachment: EntryAttachment,
): string {
  const allowedPrefixes = ["documents/entries/", "documents/captures/"];
  if (!allowedPrefixes.some((prefix) => attachment.storagePath.startsWith(prefix))) {
    throw new Error("ENTRY_ATTACHMENT_PATH_INVALID");
  }
  const segments = attachment.storagePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("ENTRY_ATTACHMENT_PATH_INVALID");
  }
  let url = transport.dav.filesRoot(transport.nextcloudUserId);
  url = transport.dav.childUrl(url, transport.syncRoot);
  for (const segment of segments) url = transport.dav.childUrl(url, segment);
  return url;
}

export async function cleanupEntryAttachments(
  transport: EntryAttachmentTransport,
  attachments: EntryAttachment[],
): Promise<void> {
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        const segments = attachment.storagePath.split("/").filter(Boolean);
        const attachmentIdIndex = segments.indexOf(attachment.id);
        if (attachmentIdIndex < 0) return;
        let url = transport.dav.filesRoot(transport.nextcloudUserId);
        url = transport.dav.childUrl(url, transport.syncRoot);
        for (const segment of segments.slice(0, attachmentIdIndex + 1)) {
          url = transport.dav.childUrl(url, segment);
        }
        await transport.dav.delete(url, true);
      } catch {
        // Best effort cleanup only. Orphan cleanup can be retried separately.
      }
    }),
  );
}
