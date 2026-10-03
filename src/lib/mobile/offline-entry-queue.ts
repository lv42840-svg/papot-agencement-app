export type OfflineEntryDraft = {
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
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("OFFLINE_DB_OPEN_FAILED"));
  });
}

export async function queueOfflineEntry(draft: OfflineEntryDraft): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("OFFLINE_DB_WRITE_FAILED"));
  });
  db.close();
}

export async function listOfflineEntries(): Promise<OfflineEntryDraft[]> {
  const db = await openDb();
  const result = await new Promise<OfflineEntryDraft[]>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as OfflineEntryDraft[]);
    request.onerror = () => reject(request.error ?? new Error("OFFLINE_DB_READ_FAILED"));
  });
  db.close();
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeOfflineEntry(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("OFFLINE_DB_DELETE_FAILED"));
  });
  db.close();
}

export type MobileEntryCapturePayload = {
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
  draft: OfflineEntryDraft,
): Promise<MobileEntryCapturePayload> {
  const files = [];
  for (const file of draft.files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    files.push({
      name: file.name || "piece-jointe",
      type: file.type || "application/octet-stream",
      base64: bytesToBase64(bytes),
    });
  }

  return {
    rawText: draft.rawText,
    priority: draft.priority,
    tagIds: draft.tagIds,
    clientId: draft.clientId || null,
    commercialCaseId: draft.commercialCaseId || null,
    files,
  };
}
