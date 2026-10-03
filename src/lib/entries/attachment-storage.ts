import "server-only";

import { randomUUID } from "node:crypto";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { NextcloudDavClient } from "@/lib/sync/nextcloud-dav";
import type { EntryAttachment } from "./domain";

export const MAX_ENTRY_ATTACHMENTS_PER_UPLOAD = 12;
export const MAX_ENTRY_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type EntryAttachmentTransport = {
  store: ServerFileStore;
  displayName: string;
};

export type LegacyEntryAttachmentTransport = {
  dav: NextcloudDavClient;
  nextcloudUserId: string;
  syncRoot: string;
};

function safeFileName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "");
  return (cleaned || "piece-jointe").slice(0, 180);
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

function validateAttachmentPath(attachment: EntryAttachment): string[] {
  const allowedPrefixes = ["documents/entries/", "documents/captures/"];
  if (!allowedPrefixes.some((prefix) => attachment.storagePath.startsWith(prefix))) {
    throw new Error("ENTRY_ATTACHMENT_PATH_INVALID");
  }
  const segments = attachment.storagePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("ENTRY_ATTACHMENT_PATH_INVALID");
  }
  return segments;
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
      const storagePath = `documents/entries/${entryId}/${id}/${objectName}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const written = await transport.store.writeBytes(storagePath, bytes);

      uploaded.push({
        id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
        storagePath: written.storagePath,
        uploadedAt: now.toISOString(),
        uploadedByName: transport.displayName,
      });
    }

    return uploaded;
  } catch (error) {
    await cleanupEntryAttachments(transport, uploaded);
    throw error;
  }
}

export async function readEntryAttachment(
  transport: Pick<EntryAttachmentTransport, "store">,
  attachment: EntryAttachment,
): Promise<Buffer> {
  validateAttachmentPath(attachment);
  const bytes = await transport.store.readBytes(attachment.storagePath, attachment.sha256);
  if (bytes.length !== attachment.sizeBytes) {
    throw new Error("ENTRY_ATTACHMENT_INTEGRITY_MISMATCH");
  }
  return bytes;
}

export async function readLegacyEntryAttachmentBytes(
  transport: LegacyEntryAttachmentTransport,
  attachment: EntryAttachment,
): Promise<Buffer> {
  const segments = validateAttachmentPath(attachment);
  let url = transport.dav.filesRoot(transport.nextcloudUserId);
  url = transport.dav.childUrl(url, transport.syncRoot);
  for (const segment of segments) url = transport.dav.childUrl(url, segment);
  return transport.dav.getBytes(url);
}

export async function cleanupEntryAttachments(
  transport: Pick<EntryAttachmentTransport, "store">,
  attachments: EntryAttachment[],
): Promise<void> {
  await Promise.all(
    attachments.map((attachment) =>
      transport.store.deleteFile(attachment.storagePath).catch(() => undefined),
    ),
  );
}
