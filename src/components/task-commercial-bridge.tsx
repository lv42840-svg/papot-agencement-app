"use client";

import Link from "next/link";
import { BriefcaseBusiness, ExternalLink, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMERCIAL_STATUS_LABELS,
  type CommercialCase,
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

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  COMMERCIAL_LOCKED: "Le suivi commercial est utilisé sur un autre poste. Réessaie dans quelques secondes.",
  COMMERCIAL_VERSION_CONFLICT: "Le suivi commercial a changé. Réessaie dans quelques secondes.",
  COMMERCIAL_SOURCE_TASK_ALREADY_LINKED: "Une affaire commerciale existe déjà pour cette tâche.",
  COMMERCIAL_REVIEW_DATE_REQUIRED: "La date de prochaine revue est obligatoire.",
};

function defaultCaseName(task: EntryRecord): string {
  return task.structuredDescription?.trim() || task.rawText.trim();
}

export function TaskCommercialBridge({ task, description, nextAction }: TaskCommercialBridgeProps) {
  const router = useRouter();
  const [cases, setCases] = useState<CommercialCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => defaultCaseName(task));
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [reviewDate, setReviewDate] = useState(task.dueDate ?? "");

  const linkedCase = useMemo(
    () => cases.find((item) => item.sourceEntryId === task.id) ?? null,
    [cases, task.id],
  );

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const body = (await response.json()) as CommercialSnapshot;
      if (!response.ok) throw new Error(body.error ?? "COMMERCIAL_LOAD_FAILED");
      setCases(body.payload.cases);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "COMMERCIAL_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de vérifier le lien avec Commercial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  useEffect(() => {
    setOpen(false);
    setError(null);
    setName(defaultCaseName(task));
    setClientName("");
    setSiteLabel("");
    setReviewDate(task.dueDate ?? "");
  }, [task.id, task.dueDate, task.rawText, task.structuredDescription]);

  async function createCommercial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !reviewDate) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/commercial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          sourceEntryId: task.id,
          name,
          clientName,
          siteLabel,
          reviewDate,
          description,
          nextAction,
        }),
      });
      const body = (await response.json()) as CommercialSnapshot;
      if (!response.ok) {
        if (body.error === "COMMERCIAL_SOURCE_TASK_ALREADY_LINKED") {
          await loadLinks();
        }
        throw new Error(body.error ?? "COMMERCIAL_CREATE_FAILED");
      }

      setCases(body.payload.cases);
      const createdId = body.focusCaseId;
      if (createdId) {
        router.push(`/commercial?focus=${encodeURIComponent(createdId)}`);
      }
    } catch (createError) {
      const code = createError instanceof Error ? createError.message : "COMMERCIAL_CREATE_FAILED";
      setError(errorMessages[code] ?? "L'affaire commerciale n'a pas pu être créée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="taskCommercialBridge">
      <div className="taskCommercialBridgeTitle">
        <span><BriefcaseBusiness size={15} /> Commercial</span>
        {loading ? <small>Vérification…</small> : null}
      </div>

      {error ? <div className="taskCommercialBridgeError">{error}</div> : null}

      {linkedCase ? (
        <div className="taskCommercialLinked">
          <div>
            <small>Affaire liée</small>
            <strong>{linkedCase.name}</strong>
            <span>{COMMERCIAL_STATUS_LABELS[linkedCase.status]}</span>
          </div>
          <Link className="secondaryButton" href={`/commercial?focus=${linkedCase.id}`}>
            <ExternalLink size={14} /> Ouvrir le commercial
          </Link>
        </div>
      ) : !loading ? (
        <>
          {!open ? (
            <button type="button" className="secondaryButton taskCommercialCreateButton" onClick={() => setOpen(true)}>
              <Plus size={14} /> Créer un commercial depuis cette tâche
            </button>
          ) : (
            <form className="taskCommercialForm" onSubmit={(event) => void createCommercial(event)}>
              <div className="taskCommercialFormHeader">
                <div>
                  <strong>Créer une piste commerciale</strong>
                  <span>Le texte de la tâche et l&apos;action à faire seront repris automatiquement.</span>
                </div>
                <button type="button" title="Fermer" onClick={() => setOpen(false)}><X size={14} /></button>
              </div>
              <label>
                <span>Nom de l&apos;affaire *</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label>
                <span>Client</span>
                <input value={clientName} onChange={(event) => setClientName(event.target.value)} />
              </label>
              <label>
                <span>Lieu chantier</span>
                <input value={siteLabel} onChange={(event) => setSiteLabel(event.target.value)} />
              </label>
              <label>
                <span>Prochaine revue *</span>
                <input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} required />
              </label>
              <button type="submit" className="primaryButton" disabled={busy || !name.trim() || !reviewDate}>
                <BriefcaseBusiness size={14} /> {busy ? "Création…" : "Créer et ouvrir dans Commercial"}
              </button>
            </form>
          )}
        </>
      ) : null}

      <style jsx global>{`
        .taskCommercialBridge { padding: 14px; display: grid; gap: 10px; border: 1px solid #e1d9f4; border-radius: 10px; background: #fbf9ff; }
        .taskCommercialBridgeTitle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .taskCommercialBridgeTitle > span { display: inline-flex; align-items: center; gap: 7px; color: #5d4ca8; font-size: 12px; font-weight: 800; }
        .taskCommercialBridgeTitle small { color: #91899f; font-size: 9px; }
        .taskCommercialBridgeError { padding: 8px 10px; border: 1px solid #efc4bc; border-radius: 8px; background: #fff5f3; color: #a3493a; font-size: 10px; }
        .taskCommercialLinked { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .taskCommercialLinked > div { min-width: 0; display: grid; gap: 2px; }
        .taskCommercialLinked small { color: #8e8798; font-size: 8px; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
        .taskCommercialLinked strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .taskCommercialLinked span { color: #75659b; font-size: 9px; }
        .taskCommercialLinked .secondaryButton, .taskCommercialCreateButton { width: max-content; min-height: 32px; display: inline-flex; align-items: center; gap: 6px; font-size: 9px; }
        .taskCommercialForm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; padding-top: 2px; }
        .taskCommercialFormHeader { grid-column: 1 / -1; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .taskCommercialFormHeader > div { display: grid; gap: 2px; }
        .taskCommercialFormHeader strong { font-size: 11px; }
        .taskCommercialFormHeader span { color: #8a8492; font-size: 9px; }
        .taskCommercialFormHeader button { width: 28px; height: 28px; padding: 0; display: grid; place-items: center; border: 1px solid #ddd8e7; border-radius: 7px; background: white; color: #777180; }
        .taskCommercialForm label { display: grid; gap: 4px; color: #5b5763; font-size: 9px; font-weight: 750; }
        .taskCommercialForm input { width: 100%; min-height: 35px; padding: 0 9px; border: 1px solid #dcd8e4; border-radius: 8px; background: white; color: var(--text); outline: none; }
        .taskCommercialForm input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent); }
        .taskCommercialForm .primaryButton { grid-column: 1 / -1; width: max-content; min-height: 35px; display: inline-flex; align-items: center; gap: 6px; }
        @media (max-width: 700px) {
          .taskCommercialLinked { align-items: stretch; flex-direction: column; }
          .taskCommercialForm { grid-template-columns: 1fr; }
          .taskCommercialFormHeader, .taskCommercialForm .primaryButton { grid-column: 1; }
        }
      `}</style>
    </section>
  );
}
