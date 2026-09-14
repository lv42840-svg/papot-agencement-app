import "server-only";

import { randomUUID } from "node:crypto";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { NextcloudDavClient } from "@/lib/sync/nextcloud-dav";
import {
  commercialDocumentCategorySchema,
  type CommercialDocument,
  type CommercialDocumentCategory,
} from "./domain";

export const MAX_COMMERCIAL_DOCUMENTS_PER_UPLOAD = 12;
export const MAX_COMMERCIAL_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type CommercialDocumentTransport = {
  store: ServerFileStore;
  displayName: string;
};

export type LegacyCommercialDocumentTransport = {
  dav: NextcloudDavClient;
  nextcloudUserId: string;
  syncRoot: string;
};

export type CommercialDocumentUploadOptions = {
  category: CommercialDocumentCategory;
  versionLabel?: string | null;
  variantLabel?: string | null;
  isCurrent?: boolean;
  isSignedQuote?: boolean;
};

function safeFileName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "");
  return (cleaned || "document").slice(0, 180);
}

function validateFiles(files: File[]): void {
  if (files.length === 0) throw new Error("COMMERCIAL_DOCUMENTS_REQUIRED");
  if (files.length > MAX_COMMERCIAL_DOCUMENTS_PER_UPLOAD) {
    throw new Error("COMMERCIAL_DOCUMENTS_TOO_MANY");
  }
  for (const file of files) {
    if (!file.name.trim()) throw new Error("COMMERCIAL_DOCUMENT_NAME_REQUIRED");
    if (file.size > MAX_COMMERCIAL_DOCUMENT_BYTES) {
      throw new Error("COMMERCIAL_DOCUMENT_TOO_LARGE");
    }
  }
}

function validateDocumentPath(document: CommercialDocument): string[] {
  if (!document.storagePath.startsWith("documents/commercial/")) {
    throw new Error("COMMERCIAL_DOCUMENT_PATH_INVALID");
  }
  const segments = document.storagePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("COMMERCIAL_DOCUMENT_PATH_INVALID");
  }
  return segments;
}

export async function uploadCommercialDocuments(
  transport: CommercialDocumentTransport,
  params: {
    caseId: string;
    creationYear: number;
    files: File[];
    options: CommercialDocumentUploadOptions;
    now?: Date;
  },
): Promise<CommercialDocument[]> {
  validateFiles(params.files);
  const category = commercialDocumentCategorySchema.parse(params.options.category);
  const now = params.now ?? new Date();
  const uploaded: CommercialDocument[] = [];

  if (params.options.isSignedQuote && category !== "QUOTE") {
    throw new Error("COMMERCIAL_SIGNED_QUOTE_CATEGORY_INVALID");
  }

  try {
    for (const file of params.files) {
      const id = randomUUID();
      const objectName = safeFileName(file.name);
      const storagePath = [
        "documents",
        "commercial",
        String(params.creationYear),
        params.caseId,
        category.toLowerCase(),
        id,
        objectName,
      ].join("/");
      const bytes = Buffer.from(await file.arrayBuffer());
      const written = await transport.store.writeBytes(storagePath, bytes);

      uploaded.push({
        id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
        storagePath: written.storagePath,
        category,
        versionLabel: params.options.versionLabel?.trim() || null,
        variantLabel: params.options.variantLabel?.trim() || null,
        isCurrent: params.options.isCurrent ?? true,
        isSignedQuote: params.options.isSignedQuote ?? false,
        uploadedAt: now.toISOString(),
        uploadedByName: transport.displayName,
      });
    }

    return uploaded;
  } catch (error) {
    await cleanupCommercialDocuments(transport, uploaded);
    throw error;
  }
}

export async function readCommercialDocument(
  transport: Pick<CommercialDocumentTransport, "store">,
  document: CommercialDocument,
): Promise<Buffer> {
  validateDocumentPath(document);
  const bytes = await transport.store.readBytes(document.storagePath, document.sha256);
  if (bytes.length !== document.sizeBytes) {
    throw new Error("COMMERCIAL_DOCUMENT_INTEGRITY_MISMATCH");
  }
  return bytes;
}

export function commercialDocumentUrl(
  transport: LegacyCommercialDocumentTransport,
  document: CommercialDocument,
): string {
  const segments = validateDocumentPath(document);
  let url = transport.dav.filesRoot(transport.nextcloudUserId);
  url = transport.dav.childUrl(url, transport.syncRoot);
  for (const segment of segments) url = transport.dav.childUrl(url, segment);
  return url;
}

export async function readLegacyCommercialDocumentBytes(
  transport: LegacyCommercialDocumentTransport,
  document: CommercialDocument,
): Promise<Buffer> {
  return transport.dav.getBytes(commercialDocumentUrl(transport, document));
}

export async function cleanupCommercialDocuments(
  transport: Pick<CommercialDocumentTransport, "store">,
  documents: CommercialDocument[],
): Promise<void> {
  await Promise.all(
    documents.map((document) =>
      transport.store.deleteFile(document.storagePath).catch(() => undefined),
    ),
  );
}
