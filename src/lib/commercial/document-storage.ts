import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextcloudDavClient } from "@/lib/sync/nextcloud-dav";
import {
  commercialDocumentCategorySchema,
  type CommercialDocument,
  type CommercialDocumentCategory,
} from "./domain";

export const MAX_COMMERCIAL_DOCUMENTS_PER_UPLOAD = 12;
export const MAX_COMMERCIAL_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type CommercialDocumentTransport = {
  dav: NextcloudDavClient;
  nextcloudUserId: string;
  syncRoot: string;
  displayName: string;
};

export type CommercialDocumentUploadOptions = {
  category: CommercialDocumentCategory;
  versionLabel?: string | null;
  variantLabel?: string | null;
  isCurrent?: boolean;
  isSignedQuote?: boolean;
};

function safeFileName(value: string): string {
  const trimmed = value.trim().replace(/[\\/\0]/g, "-");
  return (trimmed || "document").slice(0, 180);
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

async function documentCollection(
  transport: CommercialDocumentTransport,
  creationYear: number,
  caseId: string,
  category: CommercialDocumentCategory,
  documentId: string,
): Promise<string> {
  const filesRoot = transport.dav.filesRoot(transport.nextcloudUserId);
  return transport.dav.ensurePath(filesRoot, [
    transport.syncRoot,
    "documents",
    "commercial",
    String(creationYear),
    caseId,
    category.toLowerCase(),
    documentId,
  ]);
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
      const collection = await documentCollection(
        transport,
        params.creationYear,
        params.caseId,
        category,
        id,
      );
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
        storagePath: [
          "documents",
          "commercial",
          String(params.creationYear),
          params.caseId,
          category.toLowerCase(),
          id,
          objectName,
        ].join("/"),
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

export function commercialDocumentUrl(
  transport: Pick<CommercialDocumentTransport, "dav" | "nextcloudUserId" | "syncRoot">,
  document: CommercialDocument,
): string {
  const prefix = "documents/commercial/";
  if (!document.storagePath.startsWith(prefix)) {
    throw new Error("COMMERCIAL_DOCUMENT_PATH_INVALID");
  }
  const segments = document.storagePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("COMMERCIAL_DOCUMENT_PATH_INVALID");
  }
  let url = transport.dav.filesRoot(transport.nextcloudUserId);
  url = transport.dav.childUrl(url, transport.syncRoot);
  for (const segment of segments) url = transport.dav.childUrl(url, segment);
  return url;
}

export async function cleanupCommercialDocuments(
  transport: CommercialDocumentTransport,
  documents: CommercialDocument[],
): Promise<void> {
  await Promise.all(
    documents.map(async (document) => {
      try {
        const segments = document.storagePath.split("/").filter(Boolean);
        const documentIdIndex = segments.indexOf(document.id);
        if (documentIdIndex < 0) return;
        let url = transport.dav.filesRoot(transport.nextcloudUserId);
        url = transport.dav.childUrl(url, transport.syncRoot);
        for (const segment of segments.slice(0, documentIdIndex + 1)) {
          url = transport.dav.childUrl(url, segment);
        }
        await transport.dav.delete(url, true);
      } catch {
        // Best effort. Orphans can be cleaned up by maintenance if a remote failure occurs.
      }
    }),
  );
}
