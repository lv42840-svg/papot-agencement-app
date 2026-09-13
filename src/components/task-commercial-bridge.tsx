"use client";

import Link from "next/link";
import { BriefcaseBusiness, ExternalLink, Link2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMERCIAL_STATUS_LABELS,
  isCommercialClosed,
  type CommercialCase,
  type CommercialClient,
  type CommercialPayload,
} from "@/lib/commercial/domain";
import type { EntryRecord } from "@/lib/entries/domain";

type CommercialSnapshot = {
  payload: CommercialPayload;
  focusCaseId?: string;
  error?: string;
};

type TaskCommercialBridgeProps = {
  task: EntryRecord;
  description: string;
  nextAction: string;
};

type Mode = "create" | "link";

const errorMessages: Record<string, string> = {
  COMMERCIAL_SOURCE_TASK_ALREADY_LINKED: "Cette entrée est déjà rattachée à une affaire.",
  COMMERCIAL_REVIEW_DATE_REQUIRED: "La date de prochaine revue est obligatoire.",
  COMMERCIAL_CASE_NOT_FOUND: "Cette affaire n’existe plus.",
};

function defaultCaseName(task: EntryRecord): string {
  return task.structuredDescription?.trim() || task.rawText.trim();
}

export function TaskCommercialBridge({ task, description, nextAction }: TaskCommercialBridgeProps) {
  const router = useRouter();
  const [cases, setCases] = useState<CommercialCase[]>([]);
  const [clients, setClients] = useState<CommercialClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState(() => defaultCaseName(task));
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [reviewDate, setReviewDate] = useState(task.dueDate ?? "");
  const [targetCaseId, setTargetCaseId] = useState("");

  const linkedCase = useMemo(
    () => cases.find((item) => item.sourceEntryId === task.id) ?? null,
    [cases, task.id],
  );
  const linkableCases = useMemo(
    () => cases.filter((item) => !isCommercialClosed(item) && !item.sourceEntryId),
    [cases],
  );

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const body = (await response.json()) as CommercialSnapshot;
      if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_LOAD_FAILED");
      setCases(body.payload.cases);
      setClients(body.payload.clients ?? []);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "COMMERCIAL_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de vérifier le lien avec les affaires.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void loadLinks(), [loadLinks]);

  useEffect(() => {
    setOpen(false);
    setMode("create");
    setError(null);
    setName(defaultCaseName(task));
    setClientId("");
    setClientName("");
    setSiteLabel("");
    setReviewDate(task.dueDate ?? "");
    setTargetCaseId("");
  }, [task.id, task.dueDate, task.rawText, task.structuredDescription]);

  async function post(body: Record<string, unknown>): Promise<CommercialSnapshot> {
    const response = await fetch("/api/desktop/commercial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as CommercialSnapshot;
    if (!response.ok) throw new Error(result.error ?? "COMMERCIAL_MUTATION_FAILED");
    return result;
  }

  async function createAffair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !reviewDate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post({
        action: "create",
        sourceEntryId: task.id,
        name,
        existingClientId: clientId || undefined,
        clientName: clientId ? "" : clientName,
        siteLabel,
        reviewDate,
        description,
        nextAction,
      });
      setCases(result.payload.cases);
      if (result.focusCaseId) router.push(`/commercial?focus=${encodeURIComponent(result.focusCaseId)}`);
    } catch (createError) {
      const code = createError instanceof Error ? createError.message : "COMMERCIAL_CREATE_FAILED";
      setError(errorMessages[code] ?? "L’affaire n’a pas pu être créée.");
    } finally {
      setBusy(false);
    }
  }

  async function linkExisting() {
    if (!targetCaseId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post({ action: "linkSourceEntry", caseId: targetCaseId, sourceEntryId: task.id });
      setCases(result.payload.cases);
      router.push(`/commercial?focus=${encodeURIComponent(targetCaseId)}`);
    } catch (linkError) {
      const code = linkError instanceof Error ? linkError.message : "COMMERCIAL_LINK_FAILED";
      setError(errorMessages[code] ?? "L’entrée n’a pas pu être rattachée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="taskCommercialBridge">
      <div className="taskCommercialBridgeTitle">
        <span><BriefcaseBusiness size={15} /> Affaire</span>
        {loading ? <small>Vérification…</small> : null}
      </div>

      {error ? <div className="taskCommercialBridgeError">{error}</div> : null}

      {linkedCase ? (
        <div className="taskCommercialLinked">
          <div>
            <small>Affaire liée</small>
            <strong>{linkedCase.name}</strong>
            <span>{linkedCase.clientName || "Client à préciser"} · {COMMERCIAL_STATUS_LABELS[linkedCase.status]}</span>
          </div>
          <Link className="secondaryButton" href={`/commercial?focus=${linkedCase.id}`}>
            <ExternalLink size={14} /> Ouvrir
          </Link>
        </div>
      ) : !loading ? (
        <>
          {!open ? (
            <div className="taskCommercialBridgeActions">
              <button type="button" className="secondaryButton" onClick={() => { setMode("create"); setOpen(true); }}>
                <Plus size={14} /> Créer une affaire
              </button>
              <button type="button" className="secondaryButton" onClick={() => { setMode("link"); setOpen(true); }} disabled={!linkableCases.length}>
                <Link2 size={14} /> Rattacher à une affaire
              </button>
            </div>
          ) : mode === "link" ? (
            <div className="taskCommercialForm">
              <div className="taskCommercialFormHeader">
                <div><strong>Rattacher cette entrée</strong><span>Choisis une affaire existante non encore liée à une entrée.</span></div>
                <button type="button" onClick={() => setOpen(false)}><X size={14} /></button>
              </div>
              <label className="taskCommercialFull">
                <span>Affaire *</span>
                <select value={targetCaseId} onChange={(event) => setTargetCaseId(event.target.value)}>
                  <option value="">Sélectionner…</option>
                  {linkableCases.map((item) => <option key={item.id} value={item.id}>{item.name}{item.clientName ? ` · ${item.clientName}` : ""}</option>)}
                </select>
              </label>
              <button type="button" className="primaryButton" disabled={busy || !targetCaseId} onClick={() => void linkExisting()}>
                <Link2 size={14} /> {busy ? "Rattachement…" : "Rattacher et ouvrir"}
              </button>
            </div>
          ) : (
            <form className="taskCommercialForm" onSubmit={(event) => void createAffair(event)}>
              <div className="taskCommercialFormHeader">
                <div><strong>Créer une affaire</strong><span>Le contexte de l’entrée est repris automatiquement.</span></div>
                <button type="button" onClick={() => setOpen(false)}><X size={14} /></button>
              </div>
              <label><span>Nom affaire *</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
              <label><span>Client existant</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Nouveau / à préciser</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName}</option>)}</select></label>
              {!clientId ? <label><span>Nouveau client</span><input value={clientName} onChange={(event) => setClientName(event.target.value)} /></label> : null}
              <label><span>Lieu chantier</span><input value={siteLabel} onChange={(event) => setSiteLabel(event.target.value)} /></label>
              <label><span>Prochaine revue *</span><input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} required /></label>
              <button type="submit" className="primaryButton" disabled={busy || !name.trim() || !reviewDate}>
                <BriefcaseBusiness size={14} /> {busy ? "Création…" : "Créer et ouvrir"}
              </button>
            </form>
          )}
        </>
      ) : null}

      <style jsx global>{`
        .taskCommercialBridge { padding:14px; display:grid; gap:10px; border:1px solid #e1d9f4; border-radius:10px; background:#fbf9ff; }
        .taskCommercialBridgeTitle, .taskCommercialLinked, .taskCommercialBridgeActions, .taskCommercialFormHeader { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .taskCommercialBridgeTitle > span { display:inline-flex; align-items:center; gap:7px; color:#5d4ca8; font-size:12px; font-weight:800; }
        .taskCommercialBridgeTitle small, .taskCommercialFormHeader span { color:#91899f; font-size:9px; }
        .taskCommercialBridgeError { padding:8px 10px; border:1px solid #efc4bc; border-radius:8px; background:#fff5f3; color:#a3493a; font-size:10px; }
        .taskCommercialLinked > div { min-width:0; display:grid; gap:2px; }
        .taskCommercialLinked small { color:#8e8798; font-size:8px; font-weight:750; text-transform:uppercase; }
        .taskCommercialLinked strong { overflow:hidden; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
        .taskCommercialLinked span { color:#75659b; font-size:9px; }
        .taskCommercialBridgeActions { justify-content:flex-start; flex-wrap:wrap; }
        .taskCommercialBridgeActions .secondaryButton, .taskCommercialLinked .secondaryButton { min-height:32px; font-size:9px; }
        .taskCommercialForm { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        .taskCommercialFormHeader { grid-column:1/-1; align-items:flex-start; }
        .taskCommercialFormHeader > div { display:grid; gap:2px; }
        .taskCommercialFormHeader strong { font-size:11px; }
        .taskCommercialFormHeader button { width:28px; height:28px; display:grid; place-items:center; border:1px solid #ddd8e7; border-radius:7px; background:white; }
        .taskCommercialForm label { display:grid; gap:4px; color:#5b5763; font-size:9px; font-weight:750; }
        .taskCommercialForm input, .taskCommercialForm select { width:100%; min-height:35px; padding:0 9px; border:1px solid #dcd8e4; border-radius:8px; background:white; color:var(--text); }
        .taskCommercialForm .primaryButton { grid-column:1/-1; width:max-content; min-height:35px; }
        .taskCommercialFull { grid-column:1/-1; }
        @media (max-width:700px) { .taskCommercialLinked { align-items:stretch; flex-direction:column; } .taskCommercialForm { grid-template-columns:1fr; } .taskCommercialFormHeader, .taskCommercialForm .primaryButton, .taskCommercialFull { grid-column:1; } }
      `}</style>
    </section>
  );
}
