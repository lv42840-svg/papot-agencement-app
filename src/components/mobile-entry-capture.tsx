"use client";

import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, FilePlus2, Send } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ContextPayload = {
  clients: Array<{ id: string; name: string }>;
  cases: Array<{ id: string; name: string; clientId: string | null; clientName: string; status: string }>;
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
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/mobile/entries/context", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as ContextPayload;
        if (!response.ok) throw new Error(body.error ?? "Chargement impossible");
        setContext(body);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Chargement impossible"));
  }, []);

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rawText.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const form = new FormData();
      form.set("rawText", rawText);
      form.set("priority", priority);
      form.set("tagIds", JSON.stringify(tagIds));
      form.set("clientId", clientId);
      form.set("commercialCaseId", commercialCaseId);
      files.forEach((file) => form.append("files", file));
      const response = await fetch("/api/desktop/entries/capture", { method: "POST", body: form });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Envoi impossible");
      setRawText("");
      setPriority("NORMAL");
      setTagIds([]);
      setClientId("");
      setCommercialCaseId("");
      setFiles([]);
      setSuccess(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Envoi impossible");
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
          <select value={clientId} onChange={(event) => { setClientId(event.target.value); setCommercialCaseId(""); }}>
            <option value="">Aucun / à qualifier plus tard</option>
            {(context?.clients ?? []).map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>

        <label className="mobileCaptureField">
          <span>Affaire</span>
          <select value={commercialCaseId} onChange={(event) => chooseCase(event.target.value)}>
            <option value="">Client seulement / aucune affaire</option>
            {visibleCases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.clientName ? ` · ${item.clientName}` : ""}
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
              onClick={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
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
            onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }}
          />
          <input
            ref={filesRef}
            hidden
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }}
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
              <button type="button" key={`${file.name}-${index}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>
                {file.name} ×
              </button>
            ))}
          </div>
        ) : null}

        <button className="mobileSubmitButton" type="submit" disabled={busy || !rawText.trim()}>
          <Send size={18} /> {busy ? "Envoi..." : "Envoyer l’entrée"}
        </button>
      </form>

      <style jsx global>{`
        .mobileCapturePage { min-height: 100vh; background: #f7f5fb; padding: 14px; color: var(--text); }
        .mobileCaptureHeader { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px; }
        .mobileCaptureHeader > div { display:grid; gap:2px; }
        .mobileCaptureHeader strong { font-size:14px; color:#5c49ad; }
        .mobileCaptureHeader span { font-size:22px; font-weight:800; }
        .mobileCaptureHeader a { color:#6657a7; font-size:13px; font-weight:700; text-decoration:none; }
        .mobileCaptureCard { display:grid; gap:13px; padding:14px; border:1px solid #e4dff0; border-radius:15px; background:#fff; }
        .mobileCaptureField { display:grid; gap:6px; font-size:12px; font-weight:750; color:#5f596d; }
        .mobileCaptureField textarea, .mobileCaptureField select { width:100%; border:1px solid #dcd7e7; border-radius:10px; background:#fff; padding:11px; font:inherit; color:var(--text); }
        .mobileCaptureField textarea { resize:vertical; font-size:16px; }
        .mobileCaptureField select { min-height:44px; }
        .mobileUrgentButton { width:max-content; min-height:38px; padding:0 12px; display:inline-flex; align-items:center; gap:7px; border:1px solid #e5caca; border-radius:9px; background:#fff; }
        .mobileUrgentButton.isActive { background:#fff0f0; border-color:#d98d8d; color:#a33c3c; }
        .mobileCaptureTags { display:flex; flex-wrap:wrap; gap:7px; }
        .mobileCaptureTags button { min-height:34px; padding:0 10px; border:1px solid #ddd8e8; border-radius:999px; background:#fff; }
        .mobileCaptureTags button.isSelected { background:#eee9ff; border-color:#bcaee8; color:#5c49ad; }
        .mobileCaptureFiles { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
        .mobileCaptureFiles button { min-height:44px; display:flex; justify-content:center; align-items:center; gap:7px; border:1px solid #ddd8e8; border-radius:10px; background:#fff; }
        .mobilePendingFiles { display:flex; flex-wrap:wrap; gap:6px; }
        .mobilePendingFiles button { border:0; border-radius:999px; padding:7px 9px; background:#f1eef8; color:#625a72; font-size:11px; }
        .mobileSubmitButton { min-height:52px; display:flex; align-items:center; justify-content:center; gap:8px; border:0; border-radius:12px; background:#6751c8; color:#fff; font-size:16px; font-weight:800; }
        .mobileSubmitButton:disabled { opacity:.55; }
        .mobileCaptureMessage { display:flex; align-items:center; gap:7px; padding:10px 12px; margin-bottom:10px; border-radius:10px; font-size:13px; }
        .mobileCaptureMessage.isError { background:#fff0f0; color:#a33c3c; }
        .mobileCaptureMessage.isSuccess { background:#eef9f2; color:#287548; }
        @media (min-width: 720px) { .mobileCapturePage { max-width:560px; margin:0 auto; padding-top:24px; } }
      `}</style>
    </main>
  );
}