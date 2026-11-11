import "server-only";

import { randomUUID } from "node:crypto";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { EntryAttachment } from "./domain";

export const MAX_ENTRY_ATTACHMENTS_PER_UPLOAD = 12;
export const MAX_ENTRY_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type EntryAttachmentTransport = {
  store: ServerFileStore;
  displayName: string;
};

function safeFileName(valeur: string): string {
  const nettoye = valeur
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "");
  return (nettoye || "piece-jointe").slice(0, 180);
}

function validateFiles(fichiers: File[]): void {
  if (fichiers.length > MAX_ENTRY_ATTACHMENTS_PER_UPLOAD) {
    throw new Error("ENTRY_ATTACHMENTS_TOO_MANY");
  }
  for (const fichier of fichiers) {
    if (fichier.size > MAX_ENTRY_ATTACHMENT_BYTES) {
      throw new Error("ENTRY_ATTACHMENT_TOO_LARGE");
    }
    if (!fichier.name.trim()) {
      throw new Error("ENTRY_ATTACHMENT_NAME_REQUIRED");
    }
  }
}

function validateAttachmentPath(pieceJointe: EntryAttachment): string[] {
  const prefixesAutorises = ["documents/entries/", "documents/captures/"];
  if (
    !prefixesAutorises.some((prefixe) =>
      pieceJointe.storagePath.startsWith(prefixe),
    )
  ) {
    throw new Error("ENTRY_ATTACHMENT_PATH_INVALID");
  }
  const segments = pieceJointe.storagePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("ENTRY_ATTACHMENT_PATH_INVALID");
  }
  return segments;
}

export async function uploadEntryAttachments(
  transport: EntryAttachmentTransport,
  idEntree: string,
  fichiers: File[],
  maintenant = new Date(),
): Promise<EntryAttachment[]> {
  validateFiles(fichiers);
  const piecesJointesEnvoyees: EntryAttachment[] = [];

  try {
    for (const fichier of fichiers) {
      const id = randomUUID();
      const nomObjet = safeFileName(fichier.name);
      const cheminStockage = `documents/entries/${idEntree}/${id}/${nomObjet}`;
      const octets = Buffer.from(await fichier.arrayBuffer());
      const ecriture = await transport.store.writeBytes(
        cheminStockage,
        octets,
      );

      piecesJointesEnvoyees.push({
        id,
        fileName: fichier.name,
        contentType: fichier.type || "application/octet-stream",
        sizeBytes: ecriture.sizeBytes,
        sha256: ecriture.sha256,
        storagePath: ecriture.storagePath,
        uploadedAt: maintenant.toISOString(),
        uploadedByName: transport.displayName,
      });
    }

    return piecesJointesEnvoyees;
  } catch (erreur) {
    await cleanupEntryAttachments(transport, piecesJointesEnvoyees);
    throw erreur;
  }
}

export async function readEntryAttachment(
  transport: Pick<EntryAttachmentTransport, "store">,
  pieceJointe: EntryAttachment,
): Promise<Buffer> {
  validateAttachmentPath(pieceJointe);
  const octets = await transport.store.readBytes(
    pieceJointe.storagePath,
    pieceJointe.sha256,
  );
  if (octets.length !== pieceJointe.sizeBytes) {
    throw new Error("ENTRY_ATTACHMENT_INTEGRITY_MISMATCH");
  }
  return octets;
}

export async function cleanupEntryAttachments(
  transport: Pick<EntryAttachmentTransport, "store">,
  piecesJointes: EntryAttachment[],
): Promise<void> {
  await Promise.all(
    piecesJointes.map((pieceJointe) =>
      transport.store
        .deleteFile(pieceJointe.storagePath)
        .catch(() => undefined),
    ),
  );
}
