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
  COMMERCIAL_CASE_SOURCE_ALREADY_LINKED: "Cette affaire est déjà rattachée à une autre entrée.",
};

function defaultCaseName(tache: EntryRecord): string {
  return tache.structuredDescription?.trim() || tache.rawText.trim();
}

export function TaskCommercialBridge({
  task: tache,
  description,
  nextAction,
}: TaskCommercialBridgeProps) {
  const router = useRouter();
  const [cases, setCases] = useState<CommercialCase[]>([]);
  const [clients, setClients] = useState<CommercialClient[]>([]);
  const [chargement, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("create");
  const [nom, setName] = useState(() => defaultCaseName(tache));
  const [idClient, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [reviewDate, setReviewDate] = useState(tache.dueDate ?? "");
  const [targetCaseId, setTargetCaseId] = useState("");

  const linkedCase = useMemo(
    () => cases.find((element) => element.sourceEntryId === tache.id) ?? null,
    [cases, tache.id],
  );
  const linkableCases = useMemo(
    () => cases.filter((element) => !isCommercialClosed(element) && !element.sourceEntryId),
    [cases],
  );

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reponse = await fetch("/api/desktop/commercial", { cache: "no-store" });
      const corps = (await reponse.json()) as CommercialSnapshot;
      if (!reponse.ok) throw new Error(corps.error ?? "COMMERCIAL_LOAD_FAILED");
      setCases(corps.payload.cases);
      setClients(corps.payload.clients ?? []);
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
    setName(defaultCaseName(tache));
    setClientId("");
    setClientName("");
    setSiteLabel("");
    setReviewDate(tache.dueDate ?? "");
    setTargetCaseId("");
  }, [tache.id, tache.dueDate, tache.rawText, tache.structuredDescription]);

  async function post(corps: Record<string, unknown>): Promise<CommercialSnapshot> {
    const reponse = await fetch("/api/desktop/commercial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    const resultat = (await reponse.json()) as CommercialSnapshot;
    if (!reponse.ok) throw new Error(resultat.error ?? "COMMERCIAL_MUTATION_FAILED");
    return resultat;
  }

  async function createAffair(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (!nom.trim() || !reviewDate) return;
    setBusy(true);
    setError(null);
    try {
      const resultat = await post({
        action: "create",
        sourceEntryId: tache.id,
        name: nom,
        existingClientId: idClient || undefined,
        clientName: idClient ? "" : clientName,
        siteLabel,
        reviewDate,
        description,
        nextAction,
      });
      setCases(resultat.payload.cases);
      if (resultat.focusCaseId)
        router.push(`/commercial?focus=${encodeURIComponent(resultat.focusCaseId)}`);
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
      const resultat = await post({
        action: "linkSourceEntry",
        caseId: targetCaseId,
        sourceEntryId: tache.id,
      });
      setCases(resultat.payload.cases);
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
        <span>
          <BriefcaseBusiness size={15} /> Affaire
        </span>
        {chargement ? <small>Vérification…</small> : null}
      </div>

      {erreur ? <div className="taskCommercialBridgeError">{erreur}</div> : null}

      {linkedCase ? (
        <div className="taskCommercialLinked">
          <div>
            <small>Affaire liée</small>
            <strong>{linkedCase.name}</strong>
            <span>
              {linkedCase.clientName || "Client à préciser"} ·{" "}
              {COMMERCIAL_STATUS_LABELS[linkedCase.status]}
            </span>
          </div>
          <Link className="secondaryButton" href={`/commercial?focus=${linkedCase.id}`}>
            <ExternalLink size={14} /> Ouvrir
          </Link>
        </div>
      ) : !chargement ? (
        <>
          {!open ? (
            <div className="taskCommercialBridgeActions">
              <button
                type="button"
                className="secondaryButton"
                onClick={() => {
                  setMode("create");
                  setOpen(true);
                }}
              >
                <Plus size={14} /> Créer une affaire
              </button>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => {
                  setMode("link");
                  setOpen(true);
                }}
                disabled={!linkableCases.length}
              >
                <Link2 size={14} /> Rattacher à une affaire
              </button>
            </div>
          ) : mode === "link" ? (
            <div className="taskCommercialForm">
              <div className="taskCommercialFormHeader">
                <div>
                  <strong>Rattacher cette entrée</strong>
                  <span>Choisis une affaire existante non encore liée à une entrée.</span>
                </div>
                <button type="button" onClick={() => setOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <label className="taskCommercialFull">
                <span>Affaire *</span>
                <select
                  value={targetCaseId}
                  onChange={(evenement) => setTargetCaseId(evenement.target.value)}
                >
                  <option value="">Sélectionner…</option>
                  {linkableCases.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name}
                      {element.clientName ? ` · ${element.clientName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primaryButton"
                disabled={busy || !targetCaseId}
                onClick={() => void linkExisting()}
              >
                <Link2 size={14} /> {busy ? "Rattachement…" : "Rattacher et ouvrir"}
              </button>
            </div>
          ) : (
            <form
              className="taskCommercialForm"
              onSubmit={(evenement) => void createAffair(evenement)}
            >
              <div className="taskCommercialFormHeader">
                <div>
                  <strong>Créer une affaire</strong>
                  <span>Le contexte de l’entrée est repris automatiquement.</span>
                </div>
                <button type="button" onClick={() => setOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <label>
                <span>Nom affaire *</span>
                <input
                  value={nom}
                  onChange={(evenement) => setName(evenement.target.value)}
                  required
                />
              </label>
              <label>
                <span>Client existant</span>
                <select
                  value={idClient}
                  onChange={(evenement) => setClientId(evenement.target.value)}
                >
                  <option value="">Nouveau / à préciser</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {!idClient ? (
                <label>
                  <span>Nouveau client</span>
                  <input
                    value={clientName}
                    onChange={(evenement) => setClientName(evenement.target.value)}
                  />
                </label>
              ) : null}
              <label>
                <span>Lieu chantier</span>
                <input
                  value={siteLabel}
                  onChange={(evenement) => setSiteLabel(evenement.target.value)}
                />
              </label>
              <label>
                <span>Prochaine revue *</span>
                <input
                  type="date"
                  value={reviewDate}
                  onChange={(evenement) => setReviewDate(evenement.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className="primaryButton"
                disabled={busy || !nom.trim() || !reviewDate}
              >
                <BriefcaseBusiness size={14} /> {busy ? "Création…" : "Créer et ouvrir"}
              </button>
            </form>
          )}
        </>
      ) : null}

      <style jsx global>{`
        .taskCommercialBridge {
          padding: 14px;
          display: grid;
          gap: 10px;
          border: 1px solid #e1d9f4;
          border-radius: 10px;
          background: #fbf9ff;
        }
        .taskCommercialBridgeTitle,
        .taskCommercialLinked,
        .taskCommercialBridgeActions,
        .taskCommercialFormHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .taskCommercialBridgeTitle > span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #5d4ca8;
          font-size: 12px;
          font-weight: 800;
        }
        .taskCommercialBridgeTitle small,
        .taskCommercialFormHeader span {
          color: #91899f;
          font-size: 9px;
        }
        .taskCommercialBridgeError {
          padding: 8px 10px;
          border: 1px solid #efc4bc;
          border-radius: 8px;
          background: #fff5f3;
          color: #a3493a;
          font-size: 10px;
        }
        .taskCommercialLinked > div {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .taskCommercialLinked small {
          color: #8e8798;
          font-size: 8px;
          font-weight: 750;
          text-transform: uppercase;
        }
        .taskCommercialLinked strong {
          overflow: hidden;
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .taskCommercialLinked span {
          color: #75659b;
          font-size: 9px;
        }
        .taskCommercialBridgeActions {
          justify-content: flex-start;
          flex-wrap: wrap;
        }
        .taskCommercialBridgeActions .secondaryButton,
        .taskCommercialLinked .secondaryButton {
          min-height: 32px;
          font-size: 9px;
        }
        .taskCommercialForm {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }
        .taskCommercialFormHeader {
          grid-column: 1/-1;
          align-items: flex-start;
        }
        .taskCommercialFormHeader > div {
          display: grid;
          gap: 2px;
        }
        .taskCommercialFormHeader strong {
          font-size: 11px;
        }
        .taskCommercialFormHeader button {
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          border: 1px solid #ddd8e7;
          border-radius: 7px;
          background: white;
        }
        .taskCommercialForm label {
          display: grid;
          gap: 4px;
          color: #5b5763;
          font-size: 9px;
          font-weight: 750;
        }
        .taskCommercialForm input,
        .taskCommercialForm select {
          width: 100%;
          min-height: 35px;
          padding: 0 9px;
          border: 1px solid #dcd8e4;
          border-radius: 8px;
          background: white;
          color: var(--text);
        }
        .taskCommercialForm .primaryButton {
          grid-column: 1/-1;
          width: max-content;
          min-height: 35px;
        }
        .taskCommercialFull {
          grid-column: 1/-1;
        }
        @media (max-width: 700px) {
          .taskCommercialLinked {
            align-items: stretch;
            flex-direction: column;
          }
          .taskCommercialForm {
            grid-template-columns: 1fr;
          }
          .taskCommercialFormHeader,
          .taskCommercialForm .primaryButton,
          .taskCommercialFull {
            grid-column: 1;
          }
        }
      `}</style>
    </section>
  );
}
