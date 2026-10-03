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

export function draftToFormData(draft: OfflineEntryDraft): FormData {
  const form = new FormData();
  form.set("rawText", draft.rawText);
  form.set("priority", draft.priority);
  form.set("tagIds", JSON.stringify(draft.tagIds));
  form.set("clientId", draft.clientId);
  form.set("commercialCaseId", draft.commercialCaseId);
  draft.files.forEach((file) => form.append("files", file, file.name));
  return form;
}