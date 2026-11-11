export type OfflineEntryDraft = {
  ownerUserId: string;
  id: string;
  createdAt: string;
  rawText: string;
  priority: "NORMAL" | "URGENT";
  tagIds: string[];
  clientId: string;
  commercialCaseId: string;
  files: File[];
};

const DB_NAME = "papot-agencement-mobile";
const DB_VERSION = 1;
const STORE = "entry-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const requete = indexedDB.open(DB_NAME, DB_VERSION);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error ?? new Error("OFFLINE_DB_OPEN_FAILED"));
  });
}

export async function queueOfflineEntry(brouillon: OfflineEntryDraft): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(brouillon);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("OFFLINE_DB_WRITE_FAILED"));
  });
  db.close();
}

export async function listOfflineEntries(ownerUserId: string): Promise<OfflineEntryDraft[]> {
  const db = await openDb();
  const resultat = await new Promise<OfflineEntryDraft[]>((resolve, reject) => {
    const requete = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    requete.onsuccess = () => resolve((requete.result ?? []) as OfflineEntryDraft[]);
    requete.onerror = () => reject(requete.error ?? new Error("OFFLINE_DB_READ_FAILED"));
  });
  db.close();
  return resultat
    .filter((brouillon) => brouillon.ownerUserId === ownerUserId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeOfflineEntry(id: string, ownerUserId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const courant = store.get(id);
    courant.onsuccess = () => {
      if (courant.result?.ownerUserId === ownerUserId) store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("OFFLINE_DB_DELETE_FAILED"));
  });
  db.close();
}

export type MobileEntryCapturePayload = {
  requestId: string;
  ownerUserId: string;
  rawText: string;
  priority: "NORMAL" | "URGENT";
  tagIds: string[];
  clientId: string | null;
  commercialCaseId: string | null;
  files: Array<{
    name: string;
    type: string;
    base64: string;
  }>;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function draftToJsonPayload(
  brouillon: OfflineEntryDraft,
): Promise<MobileEntryCapturePayload> {
  const fichiers = [];
  for (const fichier of brouillon.files) {
    const bytes = new Uint8Array(await fichier.arrayBuffer());
    fichiers.push({
      name: fichier.name || "piece-jointe",
      type: fichier.type || "application/octet-stream",
      base64: bytesToBase64(bytes),
    });
  }

  return {
    requestId: brouillon.id,
    ownerUserId: brouillon.ownerUserId,
    rawText: brouillon.rawText,
    priority: brouillon.priority,
    tagIds: brouillon.tagIds,
    clientId: brouillon.clientId || null,
    commercialCaseId: brouillon.commercialCaseId || null,
    files: fichiers,
  };
}
