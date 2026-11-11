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
  draftToJsonPayload,
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

export function MobileEntryCapture({ userId: idUtilisateur }: { userId: string }) {
  const [contexte, setContext] = useState<ContextPayload | null>(null);
  const [rawText, setRawText] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [idClient, setClientId] = useState("");
  const [commercialCaseId, setCommercialCaseId] = useState("");
  const [fichiers, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const refreshQueuedCount = useCallback(async () => {
    const queued = await listOfflineEntries(idUtilisateur);
    setQueuedCount(queued.length);
  }, [idUtilisateur]);

  const syncQueuedEntries = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setError(null);
    try {
      const queued = await listOfflineEntries(idUtilisateur);
      for (const brouillon of queued) {
        await queueOfflineEntry(brouillon);
        const reponse = await fetch("/api/mobile/entries/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(await draftToJsonPayload(brouillon)),
        });
        if (!reponse.ok) {
          const corps = (await reponse.json()) as { error?: string };
          throw new Error(corps.error ?? "Synchronisation impossible");
        }
        await removeOfflineEntry(brouillon.id, idUtilisateur);
      }
      await refreshQueuedCount();
      if (queued.length > 0) setSuccess(true);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Synchronisation impossible");
    } finally {
      setSyncing(false);
    }
  }, [refreshQueuedCount, idUtilisateur]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshQueuedCount();

    // Remove the legacy shared customer cache; never load it for another account.
    localStorage.removeItem("papot-mobile-entry-context");

    void fetch("/api/mobile/entries/context", { cache: "no-store" })
      .then(async (reponse) => {
        const corps = (await reponse.json()) as ContextPayload;
        if (!reponse.ok) throw new Error(corps.error ?? "Chargement impossible");
        setContext(corps);
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
    const all = contexte?.cases ?? [];
    return idClient ? all.filter((element) => element.clientId === idClient) : all;
  }, [idClient, contexte?.cases]);

  function chooseCase(idAffaire: string) {
    setCommercialCaseId(idAffaire);
    const selectionne = contexte?.cases.find((element) => element.id === idAffaire);
    if (selectionne?.clientId) setClientId(selectionne.clientId);
  }

  function addFiles(suivant: File[]) {
    setFiles((courant) => [...courant, ...suivant].slice(0, 12));
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
    const brouillon: OfflineEntryDraft = {
      ownerUserId: idUtilisateur,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      rawText,
      priority,
      tagIds,
      clientId: idClient,
      commercialCaseId,
      files: fichiers,
    };
    await queueOfflineEntry(brouillon);
    await refreshQueuedCount();
    resetForm();
  }

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (!rawText.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      if (!navigator.onLine) {
        await saveOfflineDraft();
        return;
      }

      const brouillon: OfflineEntryDraft = {
        ownerUserId: idUtilisateur,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        rawText,
        priority,
        tagIds,
        clientId: idClient,
        commercialCaseId,
        files: fichiers,
      };
      await queueOfflineEntry(brouillon);
      const reponse = await fetch("/api/mobile/entries/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await draftToJsonPayload(brouillon)),
      });
      const corps = (await reponse.json()) as { error?: string };
      if (!reponse.ok) throw new Error(corps.error ?? "Envoi impossible");
      await removeOfflineEntry(brouillon.id, idUtilisateur);
      await refreshQueuedCount();
      resetForm();
      setSuccess(true);
    } catch (submitError) {
      if (!navigator.onLine || submitError instanceof TypeError) {
        await refreshQueuedCount();
        resetForm();
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
      {erreur ? <div className="mobileCaptureMessage isError">{erreur}</div> : null}
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
            onChange={(evenement) => setRawText(evenement.target.value)}
            rows={5}
            placeholder="Ex. chantier Dupont, prévoir retour SAV porte meuble..."
            required
          />
        </label>

        <button
          type="button"
          className={`mobileUrgentButton${priority === "URGENT" ? " isActive" : ""}`}
          onClick={() => setPriority((courant) => (courant === "URGENT" ? "NORMAL" : "URGENT"))}
        >
          <AlertTriangle size={16} /> Urgent
        </button>

        <label className="mobileCaptureField">
          <span>Client</span>
          <select
            value={idClient}
            onChange={(evenement) => {
              setClientId(evenement.target.value);
              setCommercialCaseId("");
            }}
          >
            <option value="">Aucun / à qualifier plus tard</option>
            {(contexte?.clients ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mobileCaptureField">
          <span>Affaire</span>
          <select
            value={commercialCaseId}
            onChange={(evenement) => chooseCase(evenement.target.value)}
          >
            <option value="">Client seulement / aucune affaire</option>
            {visibleCases.map((element) => (
              <option key={element.id} value={element.id}>
                {element.name}
                {element.clientName ? ` · ${element.clientName}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="mobileCaptureTags">
          {(contexte?.tags ?? []).map((etiquette) => (
            <button
              type="button"
              key={etiquette.id}
              className={tagIds.includes(etiquette.id) ? "isSelected" : ""}
              onClick={() =>
                setTagIds((courant) =>
                  courant.includes(etiquette.id)
                    ? courant.filter((id) => id !== etiquette.id)
                    : [...courant, etiquette.id],
                )
              }
            >
              {etiquette.label}
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
            onChange={(evenement) => {
              addFiles(Array.from(evenement.target.files ?? []));
              evenement.currentTarget.value = "";
            }}
          />
          <input
            ref={filesRef}
            hidden
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={(evenement) => {
              addFiles(Array.from(evenement.target.files ?? []));
              evenement.currentTarget.value = "";
            }}
          />
          <button type="button" onClick={() => cameraRef.current?.click()}>
            <Camera size={17} /> Photo
          </button>
          <button type="button" onClick={() => filesRef.current?.click()}>
            <FilePlus2 size={17} /> Fichiers
          </button>
        </div>

        {fichiers.length > 0 ? (
          <div className="mobilePendingFiles">
            {fichiers.map((fichier, indice) => (
              <button
                type="button"
                key={`${fichier.name}-${indice}`}
                onClick={() => setFiles((courant) => courant.filter((_, i) => i !== indice))}
              >
                {fichier.name} ×
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
