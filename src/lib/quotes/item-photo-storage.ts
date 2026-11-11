import "server-only";

import path from "node:path";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { QuoteItemPhoto } from "./model";

export const QUOTE_ITEM_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeName(valeur: string): string {
  const base = path.basename(valeur || "photo").normalize("NFKC");
  const cleaned = base
    .replace(/[<>:"/\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || "photo").slice(0, 180);
}

export async function uploadQuoteItemPhotos(
  store: ServerFileStore,
  saisie: { quoteId: string; itemId: string; files: File[]; uploadedByName: string },
): Promise<QuoteItemPhoto[]> {
  if (saisie.files.length === 0) throw new Error("QUOTE_ITEM_PHOTO_REQUIRED");
  const uploaded: QuoteItemPhoto[] = [];
  try {
    for (const fichier of saisie.files) {
      if (!ALLOWED_TYPES.has(fichier.type)) throw new Error("QUOTE_ITEM_PHOTO_TYPE_INVALID");
      if (fichier.size <= 0) throw new Error("QUOTE_ITEM_PHOTO_EMPTY");
      if (fichier.size > QUOTE_ITEM_PHOTO_MAX_BYTES) throw new Error("QUOTE_ITEM_PHOTO_TOO_LARGE");
      const id = globalThis.crypto.randomUUID();
      const fileName = safeName(fichier.name);
      const storagePath = `quotes/${saisie.quoteId}/items/${saisie.itemId}/photos/${id}/${fileName}`;
      const bytes = new Uint8Array(await fichier.arrayBuffer());
      const written = await store.writeBytes(storagePath, bytes);
      uploaded.push({
        id,
        fileName,
        contentType: fichier.type as QuoteItemPhoto["contentType"],
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
        storagePath: written.storagePath,
        clientVisible: false,
        uploadedAt: new Date().toISOString(),
        uploadedByName: saisie.uploadedByName,
      });
    }
    return uploaded;
  } catch (erreur) {
    await Promise.all(
      uploaded.map((photo) => store.deleteFile(photo.storagePath).catch(() => false)),
    );
    throw erreur;
  }
}

export async function cleanupQuoteItemPhotos(store: ServerFileStore, photos: QuoteItemPhoto[]) {
  await Promise.all(photos.map((photo) => store.deleteFile(photo.storagePath).catch(() => false)));
}
