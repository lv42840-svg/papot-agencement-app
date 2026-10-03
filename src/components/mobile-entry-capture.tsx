"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FilePlus2,
  RefreshCw,
  Send,
  WifiOff,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  draftToFormData,
  listOfflineEntries,
  queueOfflineEntry,
  removeOfflineEntry,
  type OfflineEntryDraft,
} from "@/lib/mobile/offline-entry-queue";

type ContextPayload = {
  clients: Array<{ id: string; name: string }>;
  cases: Array<{
    id: string;
    name: string;
    clientId: string | null;
    clientName: string;
    status: string;
  }>;
  tags: Array<{ id: string; label: string; active: boolean; sortOrder: number }>;
  error?: string;
};

export function MobileEntryCapture() {
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [rawText, setRawText] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [clientId, setClientId] = useState("");
  const [commercialCaseId, setCommercialCaseId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const refreshQueuedCount = useCallback(async () => {
    const queued = await listOfflineEntries();
    setQueuedCount(queued.length);
  }, []);

  const syncQueuedEntries = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setError(null);
    try {
      const queued = await listOfflineEntries();
      for (const draft of queued) {
        const response = await fetch("/api/desktop/entries/capture", {
          method: "POST",
          body: draftToFormData(draft),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Synchronisation impossible");
        }
        await removeOfflineEntry(draft.id);
      }
      await refreshQueuedCount();
      if (queued.length > 0) setSuccess(true);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Synchronisation impossible");
    } finally {
      setSyncing(false);
    }
  }, [refreshQueuedCount]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshQueuedCount();

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then(async () => {
        if (!("caches" in window)) return;
        const cache = await caches.open("papot-mobile-shell-v2");
        const resources = new Set<string>(["/capture"]);
        for (const entry of performance.getEntriesByType("resource")) {
          const url = new URL(entry.name);
          if (
            url.origin === window.location.origin &&
            (url.pathname.startsWith("/_next/") || url.pathname === "/capture")
          ) {
            resources.add(url.pathname + url.search);
          }
        }
        for (const resource of resources) {
          try {
            await cache.add(resource);
          } catch {
            // A single optional asset must not block offline preparation.
          }
        }
      });
    }

    const cachedContext = localStorage.getItem("papot-mobile-entry-context");
    if (cachedContext) {
      try {
        setContext(JSON.parse(cachedContext) as ContextPayload);
      } catch {
        localStorage.removeItem("papot-mobile-entry-context");
      }
    }

    void fetch("/api/mobile/entries/context", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as ContextPayload;
        if (!response.ok) throw new Error(body.error ?? "Chargement impossible");
        setContext(body);
        localStorage.setItem("papot-mobile-entry-context", JSON.stringify(body));
      })
      .catch(() => undefined);

    const handleOnline = () => {
      setOnline(true);
      void syncQueuedEntries();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshQueuedCount, syncQueuedEntries]);

  const visibleCases = useMemo(() => {
    const all = context?.cases ?? [];
    return clientId ? all.filter((item) => item.clientId === clientId) : all;
  }, [clientId, context?.cases]);

  function chooseCase(caseId: string) {
    setCommercialCaseId(caseId);
    const selected = context?.cases.find((item) => item.id === caseId);
    if (selected?.clientId) setClientId(selected.clientId);
  }

  function addFiles(next: File[]) {
    setFiles((current) => [...current, ...next].slice(0, 12));
  }

  function resetForm() {
    setRawText("");
    setPriority("NORMAL");
    setTagIds([]);
    setClientId("");
    setCommercialCaseId("");
    setFiles([]);
  }

  async function saveOfflineDraft(): Promise<void> {
    const draft: OfflineEntryDraft = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      rawText,
      priority,
      tagIds,
      clientId,
      commercialCaseId,
      files,
    };
    await queueOfflineEntry(draft);
    await refreshQueuedCount();
    resetForm();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rawText.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      if (!navigator.onLine) {
        await saveOfflineDraft();
        return;
      }

      const draft: OfflineEntryDraft = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        rawText,
        priority,
        tagIds,
        clientId,
        commercialCaseId,
        files,
      };
      const response = await fetch("/api/desktop/entries/capture", {
        method: "POST",
        body: draftToFormData(draft),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Envoi impossible");
      resetForm();
      setSuccess(true);
    } catch (submitError) {
      if (!navigator.onLine || submitError instanceof TypeError) {
        await saveOfflineDraft();
        setOnline(false);
      } else {
        setError(submitError instanceof Error ? submitError.message : "Envoi impossible");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mobileCapturePage">
      <header className="mobileCaptureHeader">
        <div>
          <strong>PAPOT AGENCEMENT</strong>
          <span>Nouvelle entrée</span>
        </div>
        <Link href="/entrees">Entrées</Link>
      </header>

      {!online ? (
        <div className="mobileCaptureMessage isOffline">
          <WifiOff size={18} /> Hors ligne. Les captures restent sur l’iPhone.
        </div>
      ) : null}
      {queuedCount > 0 ? (
        <div className="mobileCaptureQueue">
          <strong>
            {queuedCount} entrée{queuedCount > 1 ? "s" : ""} en attente
          </strong>
          <button
            type="button"
            disabled={!online || syncing}
            onClick={() => void syncQueuedEntries()}
          >
            <RefreshCw size={15} /> {syncing ? "Synchronisation..." : "Synchroniser"}
          </button>
        </div>
      ) : null}
      {error ? <div className="mobileCaptureMessage isError">{error}</div> : null}
      {success ? (
        <div className="mobileCaptureMessage isSuccess">
          <CheckCircle2 size={18} /> Entrée envoyée.
        </div>
      ) : null}

      <form className="mobileCaptureCard" onSubmit={submit}>
        <label className="mobileCaptureField">
          <span>Qu’est-ce qu’il faut noter ? *</span>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={5}
            placeholder="Ex. chantier Dupont, prévoir retour SAV porte meuble..."
            required
          />
        </label>

        <button
          type="button"
          className={`mobileUrgentButton${priority === "URGENT" ? " isActive" : ""}`}
          onClick={() => setPriority((current) => (current === "URGENT" ? "NORMAL" : "URGENT"))}
        >
          <AlertTriangle size={16} /> Urgent
        </button>

        <label className="mobileCaptureField">
          <span>Client</span>
          <select
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setCommercialCaseId("");
            }}
          >
            <option value="">Aucun / à qualifier plus tard</option>
            {(context?.clients ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mobileCaptureField">
          <span>Affaire</span>
          <select value={commercialCaseId} onChange={(event) => chooseCase(event.target.value)}>
            <option value="">Client seulement / aucune affaire</option>
            {visibleCases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.clientName ? ` · ${item.clientName}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="mobileCaptureTags">
          {(context?.tags ?? []).map((tag) => (
            <button
              type="button"
              key={tag.id}
              className={tagIds.includes(tag.id) ? "isSelected" : ""}
              onClick={() =>
                setTagIds((current) =>
                  current.includes(tag.id)
                    ? current.filter((id) => id !== tag.id)
                    : [...current, tag.id],
                )
              }
            >
              {tag.label}
            </button>
          ))}
        </div>

        <div className="mobileCaptureFiles">
          <input
            ref={cameraRef}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={filesRef}
            hidden
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <button type="button" onClick={() => cameraRef.current?.click()}>
            <Camera size={17} /> Photo
          </button>
          <button type="button" onClick={() => filesRef.current?.click()}>
            <FilePlus2 size={17} /> Fichiers
          </button>
        </div>

        {files.length > 0 ? (
          <div className="mobilePendingFiles">
            {files.map((file, index) => (
              <button
                type="button"
                key={`${file.name}-${index}`}
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                {file.name} ×
              </button>
            ))}
          </div>
        ) : null}

        <button className="mobileSubmitButton" type="submit" disabled={busy || !rawText.trim()}>
          <Send size={18} />{" "}
          {busy ? "Enregistrement..." : online ? "Envoyer l’entrée" : "Garder hors ligne"}
        </button>
      </form>
    </main>
  );
}
