"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Paperclip,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { TaskCommercialBridge } from "@/components/task-commercial-bridge";
import {
  isAssignedOverdue,
  normalizePersonName,
  parisDateKey,
  type EntriesPayload,
  type EntriesTag,
  type EntryAttachment,
  type EntryRecord,
} from "@/lib/entries/domain";

type TasksSnapshot = {
  payload: EntriesPayload;
  actor: { userId: string; displayName: string };
  serverNow: string;
};

type MutationBody = Record<string, unknown> & { action: string };
type TaskGroupKey = "overdue" | "today" | "week" | "later" | "undated";

type TaskGroup = {
  key: TaskGroupKey;
  label: string;
  tasks: EntryRecord[];
};

const groupLabels: Record<TaskGroupKey, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  week: "Cette semaine",
  later: "Plus tard",
  undated: "Sans date",
};

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  ENTRIES_LOCKED: "Les tâches sont modifiées sur un autre poste. Réessaie dans quelques secondes.",
  ENTRIES_VERSION_CONFLICT: "Les tâches ont changé sur un autre poste. La liste a été rechargée.",
  ENTRY_NOT_ASSIGNED_TO_ACTOR: "Cette tâche est maintenant affectée à une autre personne.",
  POSTPONE_DATE_NOT_LATER: "La nouvelle échéance doit être postérieure à l'échéance actuelle.",
  ENTRY_ATTACHMENTS_TOO_MANY: "Tu peux ajouter jusqu'à 12 pièces à la fois.",
  ENTRY_ATTACHMENT_TOO_LARGE: "Une pièce jointe dépasse la limite technique de 100 Mo.",
  ENTRY_ATTACHMENTS_REQUIRED: "Aucune pièce jointe n'a été sélectionnée.",
};

function formatDateOnly(valeur: string | null): string {
  if (!valeur) return "Sans date";
  const [annee, mois, jour] = valeur.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(annee, mois - 1, jour, 12));
}

function formatDateTime(valeur: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(valeur));
}

function formatBytes(valeur: number): string {
  if (valeur < 1024) return `${valeur} o`;
  if (valeur < 1024 * 1024) return `${Math.round(valeur / 1024)} Ko`;
  return `${(valeur / (1024 * 1024)).toFixed(valeur >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function addDaysKey(dateKey: string, jours: number): string {
  const [annee, mois, jour] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour + jours, 12));
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function endOfWeekKey(aujourdhui: string): string {
  const [annee, mois, jour] = aujourdhui.split("-").map(Number);
  const weekday = new Date(Date.UTC(annee, mois - 1, jour, 12)).getUTCDay();
  return addDaysKey(aujourdhui, weekday === 0 ? 0 : 7 - weekday);
}

function taskTitle(tache: EntryRecord): string {
  return tache.nextAction?.trim() || tache.structuredDescription?.trim() || tache.rawText;
}

function taskSort(a: EntryRecord, b: EntryRecord): number {
  const dateCompare = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
  if (dateCompare !== 0) return dateCompare;
  const urgentCompare = Number(b.priority === "URGENT") - Number(a.priority === "URGENT");
  return urgentCompare || a.createdAt.localeCompare(b.createdAt);
}

function personalTasks(snapshot: TasksSnapshot | null): EntryRecord[] {
  if (!snapshot) return [];
  const auteur = normalizePersonName(snapshot.actor.displayName);
  return snapshot.payload.entries
    .filter(
      (entree) =>
        entree.status === "ASSIGNED" &&
        Boolean(entree.assigneeName) &&
        normalizePersonName(entree.assigneeName ?? "") === auteur,
    )
    .sort(taskSort);
}

function groupTasks(taches: EntryRecord[], maintenant: Date): TaskGroup[] {
  const aujourdhui = parisDateKey(maintenant);
  const endOfWeek = endOfWeekKey(aujourdhui);
  const buckets: Record<TaskGroupKey, EntryRecord[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    undated: [],
  };

  for (const tache of taches) {
    if (!tache.dueDate) buckets.undated.push(tache);
    else if (tache.dueDate < aujourdhui) buckets.overdue.push(tache);
    else if (tache.dueDate === aujourdhui) buckets.today.push(tache);
    else if (tache.dueDate <= endOfWeek) buckets.week.push(tache);
    else buckets.later.push(tache);
  }

  return (["overdue", "today", "week", "later", "undated"] as TaskGroupKey[])
    .map((cle) => ({ key: cle, label: groupLabels[cle], tasks: buckets[cle] }))
    .filter((group) => group.tasks.length > 0);
}

function attachmentHref(
  tache: EntryRecord,
  pieceJointe: EntryAttachment,
  download = false,
): string {
  return `/api/desktop/entries/${tache.id}/attachments/${pieceJointe.id}${download ? "?download=1" : ""}`;
}

function useTasksData() {
  const [snapshot, setSnapshot] = useState<TasksSnapshot | null>(null);
  const [chargement, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reponse = await fetch("/api/desktop/entries", { cache: "no-store" });
      const corps = (await reponse.json()) as TasksSnapshot & { error?: string };
      if (!reponse.ok) throw new Error(corps.error ?? "TASKS_LOAD_FAILED");
      setSnapshot(corps);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "TASKS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger les tâches pour le moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(async (corps: MutationBody, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reponse = await fetch("/api/desktop/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const resultat = (await reponse.json()) as TasksSnapshot & { error?: string };
      if (!reponse.ok) {
        throw new Error(
          errorMessages[resultat.error ?? ""] ??
            "L'action sur la tâche n'a pas pu être enregistrée.",
        );
      }
      setSnapshot(resultat);
      setNotice(successMessage);
      return true;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "L'action n'a pas pu être enregistrée.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const upload = useCallback(async (idEntree: string, fichiers: File[]) => {
    if (fichiers.length === 0) return true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      fichiers.forEach((fichier) => form.append("files", fichier));
      const reponse = await fetch(`/api/desktop/entries/${idEntree}/attachments`, {
        method: "POST",
        body: form,
      });
      const resultat = (await reponse.json()) as TasksSnapshot & { error?: string };
      if (!reponse.ok) {
        throw new Error(
          errorMessages[resultat.error ?? ""] ?? "Les pièces jointes n'ont pas pu être ajoutées.",
        );
      }
      setSnapshot(resultat);
      setNotice(
        `${fichiers.length} pièce${fichiers.length > 1 ? "s" : ""} jointe${fichiers.length > 1 ? "s" : ""} ajoutée${fichiers.length > 1 ? "s" : ""}.`,
      );
      return true;
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "L'ajout des pièces jointes a échoué.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { snapshot, loading: chargement, busy, error: erreur, notice, load, mutate, upload };
}

export function TasksDetailWorkspace() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const {
    snapshot,
    loading: chargement,
    busy,
    error: erreur,
    notice,
    load,
    mutate,
    upload,
  } = useTasksData();
  const [selectedId, setSelectedId] = useState<string | null>(focusId);

  const maintenant = useMemo(
    () => new Date(snapshot?.serverNow ?? Date.now()),
    [snapshot?.serverNow],
  );
  const taches = useMemo(() => personalTasks(snapshot), [snapshot]);
  const groups = useMemo(() => groupTasks(taches, maintenant), [taches, maintenant]);
  const selectedTask = taches.find((tache) => tache.id === selectedId) ?? taches[0] ?? null;
  const aujourdhui = parisDateKey(maintenant);
  const overdueCount = taches.filter((tache) => isAssignedOverdue(tache, maintenant)).length;
  const todayCount = taches.filter((tache) => tache.dueDate === aujourdhui).length;
  const urgentCount = taches.filter((tache) => tache.priority === "URGENT").length;

  useEffect(() => {
    if (focusId && taches.some((tache) => tache.id === focusId)) {
      setSelectedId(focusId);
      return;
    }
    if (!selectedId || !taches.some((tache) => tache.id === selectedId)) {
      setSelectedId(taches[0]?.id ?? null);
    }
  }, [focusId, selectedId, taches]);

  return (
    <div className="taskDetailWorkspace">
      <section className="taskDetailHeading">
        <div>
          <h1>Mes tâches</h1>
          <p>
            Clique sur une tâche pour consulter ses pièces jointes et modifier ses informations.
          </p>
        </div>
        <button
          type="button"
          className="taskRefreshButton"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw size={15} /> Actualiser
        </button>
      </section>

      {erreur ? <div className="taskMessage taskMessageError">{erreur}</div> : null}
      {notice ? <div className="taskMessage taskMessageSuccess">{notice}</div> : null}

      <section className="taskSummary" aria-label="Résumé des tâches">
        <SummaryCard value={taches.length} label="Actives" />
        <SummaryCard
          value={overdueCount}
          label="En retard"
          tone={overdueCount > 0 ? "alert" : undefined}
        />
        <SummaryCard value={todayCount} label="Aujourd'hui" />
        <SummaryCard
          value={urgentCount}
          label="Urgentes"
          tone={urgentCount > 0 ? "urgent" : undefined}
        />
      </section>

      {chargement && !snapshot ? (
        <div className="taskLoading">
          <RefreshCw size={18} className="taskSpin" /> Chargement des tâches…
        </div>
      ) : taches.length === 0 ? (
        <div className="taskEmpty">
          <CheckCircle2 size={36} />
          <strong>Aucune tâche active</strong>
          <span>Les tâches terminées restent conservées dans l&apos;historique des Entrées.</span>
        </div>
      ) : (
        <div className="taskMasterDetail">
          <aside className="taskListPanel">
            {groups.map((group) => (
              <section className="taskListGroup" key={group.key}>
                <div className={`taskListGroupTitle taskListGroupTitle-${group.key}`}>
                  <strong>{group.label}</strong>
                  <span>{group.tasks.length}</span>
                </div>
                {group.tasks.map((tache) => (
                  <button
                    type="button"
                    key={tache.id}
                    className={`taskListRow${tache.id === selectedTask?.id ? " isSelected" : ""}${group.key === "overdue" ? " isOverdue" : ""}`}
                    onClick={() => setSelectedId(tache.id)}
                  >
                    <div className="taskListRowTop">
                      <span className={`taskDatePill taskDatePill-${group.key}`}>
                        <CalendarClock size={11} /> {formatDateOnly(tache.dueDate)}
                      </span>
                      {tache.priority === "URGENT" ? (
                        <span className="taskUrgentPill">Urgent</span>
                      ) : null}
                      {tache.attachments.length > 0 ? (
                        <span className="taskAttachmentPill">
                          <Paperclip size={10} /> {tache.attachments.length}
                        </span>
                      ) : null}
                    </div>
                    <strong>{taskTitle(tache)}</strong>
                    <small>{tache.rawText}</small>
                  </button>
                ))}
              </section>
            ))}
          </aside>

          <main className="taskDetailPanel">
            {selectedTask && snapshot ? (
              <TaskDetail
                key={selectedTask.id}
                task={selectedTask}
                tags={snapshot.payload.tags}
                busy={busy}
                mutate={mutate}
                upload={upload}
              />
            ) : null}
          </main>
        </div>
      )}

      <TaskDetailStyles />
    </div>
  );
}

function SummaryCard({
  value: valeur,
  label: libelle,
  tone,
}: {
  value: number;
  label: string;
  tone?: "alert" | "urgent";
}) {
  return (
    <div className={tone ? `is-${tone}` : ""}>
      <strong>{valeur}</strong>
      <span>{libelle}</span>
    </div>
  );
}

function TaskDetail({
  task: tache,
  tags: etiquettes,
  busy,
  mutate,
  upload,
}: {
  task: EntryRecord;
  tags: EntriesTag[];
  busy: boolean;
  mutate: (corps: MutationBody, successMessage: string) => Promise<boolean>;
  upload: (idEntree: string, fichiers: File[]) => Promise<boolean>;
}) {
  const [description, setDescription] = useState(tache.structuredDescription ?? tache.rawText);
  const [nextAction, setNextAction] = useState(tache.nextAction ?? tache.rawText);
  const [priority, setPriority] = useState<"NORMAL" | "URGENT">(tache.priority);
  const [tagIds, setTagIds] = useState<string[]>(tache.tagIds);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");
  const [resultat, setResult] = useState("");
  const [fichiers, setFiles] = useState<File[]>([]);

  const visibleTags = etiquettes
    .filter((etiquette) => etiquette.active || tagIds.includes(etiquette.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  async function saveDetails() {
    await mutate(
      {
        action: "updateAssigned",
        entryId: tache.id,
        description,
        nextAction,
        priority,
        tagIds,
      },
      "Informations de la tâche enregistrées.",
    );
  }

  async function submitPostpone(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const ok = await mutate(
      {
        action: "postpone",
        entryId: tache.id,
        dueDate: postponeDate,
        reason: postponeReason,
      },
      "Échéance reportée. Nadia et Lucien sont informés dans PAPOT.",
    );
    if (ok) {
      setPostponeDate("");
      setPostponeReason("");
    }
  }

  async function submitFiles() {
    if (fichiers.length === 0) return;
    const ok = await upload(tache.id, fichiers);
    if (ok) setFiles([]);
  }

  return (
    <div className="taskDetailContent">
      <header className="taskDetailHeader">
        <div>
          <div className="taskDetailBadges">
            <span className="taskDatePill">
              <CalendarClock size={12} /> {formatDateOnly(tache.dueDate)}
            </span>
            {tache.priority === "URGENT" ? <span className="taskUrgentPill">Urgent</span> : null}
          </div>
          <h2>{taskTitle(tache)}</h2>
          <p>
            Responsable : <strong>{tache.assigneeName}</strong>
          </p>
        </div>
        <Link href="/entrees" className="taskOpenEntries">
          Ouvrir Entrées
        </Link>
      </header>

      <section className="taskOriginBox">
        <span>Texte d&apos;origine</span>
        <p>{tache.rawText}</p>
      </section>

      <TaskCommercialBridge task={tache} description={description} nextAction={nextAction} />

      <section className="taskDetailSection">
        <div className="taskSectionTitle">
          <Save size={15} /> Modifier la tâche
        </div>
        <label className="taskField">
          <span>C&apos;est quoi ?</span>
          <textarea
            rows={3}
            value={description}
            onChange={(evenement) => setDescription(evenement.target.value)}
          />
        </label>
        <label className="taskField">
          <span>J&apos;en fais quoi ?</span>
          <textarea
            rows={3}
            value={nextAction}
            onChange={(evenement) => setNextAction(evenement.target.value)}
          />
        </label>

        <div className="taskEditOptions">
          <button
            type="button"
            className={`taskPriorityButton${priority === "URGENT" ? " isUrgent" : ""}`}
            onClick={() => setPriority((courant) => (courant === "URGENT" ? "NORMAL" : "URGENT"))}
          >
            <AlertTriangle size={13} /> {priority === "URGENT" ? "Urgent" : "Passer en urgent"}
          </button>
          {visibleTags.map((etiquette) => (
            <button
              type="button"
              key={etiquette.id}
              className={`taskTagButton${tagIds.includes(etiquette.id) ? " isSelected" : ""}`}
              onClick={() =>
                setTagIds((courant) =>
                  courant.includes(etiquette.id)
                    ? courant.filter((tagId) => tagId !== etiquette.id)
                    : [...courant, etiquette.id],
                )
              }
            >
              {etiquette.label}
              {!etiquette.active ? " (désactivé)" : ""}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primaryButton taskSaveButton"
          disabled={busy || !description.trim() || !nextAction.trim()}
          onClick={() => void saveDetails()}
        >
          <Save size={15} /> Enregistrer les modifications
        </button>
      </section>

      <section className="taskDetailSection">
        <div className="taskSectionTitle">
          <Paperclip size={15} /> Pièces jointes ({tache.attachments.length})
        </div>
        {tache.attachments.length === 0 ? (
          <p className="taskMuted">Aucune pièce jointe sur cette tâche.</p>
        ) : (
          <div className="taskAttachments">
            {tache.attachments.map((pieceJointe) => (
              <AttachmentRow key={pieceJointe.id} task={tache} attachment={pieceJointe} />
            ))}
          </div>
        )}
        <div className="taskUploadBox">
          <label>
            <Upload size={14} /> Ajouter des photos ou documents
            <input
              type="file"
              multiple
              onChange={(evenement) => setFiles(Array.from(evenement.target.files ?? []))}
              disabled={busy}
            />
          </label>
          {fichiers.length > 0 ? (
            <div className="taskSelectedFiles">
              {fichiers.map((fichier) => (
                <span key={`${fichier.name}-${fichier.size}`}>{fichier.name}</span>
              ))}
              <button
                type="button"
                className="secondaryButton"
                disabled={busy}
                onClick={() => void submitFiles()}
              >
                Envoyer {fichiers.length} pièce{fichiers.length > 1 ? "s" : ""}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="taskDetailSection">
        <div className="taskSectionTitle">
          <Clock3 size={15} /> Échéance
        </div>
        <p className="taskCurrentDeadline">
          Échéance actuelle : <strong>{formatDateOnly(tache.dueDate)}</strong>
        </p>
        <form className="taskPostponeForm" onSubmit={(evenement) => void submitPostpone(evenement)}>
          <label className="taskField">
            <span>Nouvelle échéance</span>
            <input
              type="date"
              min={tache.dueDate ? addDaysKey(tache.dueDate, 1) : undefined}
              value={postponeDate}
              onChange={(evenement) => setPostponeDate(evenement.target.value)}
              required
            />
          </label>
          <label className="taskField">
            <span>Motif obligatoire</span>
            <input
              value={postponeReason}
              onChange={(evenement) => setPostponeReason(evenement.target.value)}
              placeholder="Pourquoi la date est repoussée ?"
              required
            />
          </label>
          <button
            type="submit"
            className="secondaryButton"
            disabled={busy || !postponeDate || !postponeReason.trim()}
          >
            Reporter l&apos;échéance
          </button>
        </form>
      </section>

      <section className="taskDetailSection taskCompleteSection">
        <div className="taskSectionTitle">
          <Check size={15} /> Terminer
        </div>
        <label className="taskField">
          <span>Résultat facultatif</span>
          <textarea
            rows={2}
            value={resultat}
            onChange={(evenement) => setResult(evenement.target.value)}
          />
        </label>
        <button
          type="button"
          className="taskCompleteButton"
          disabled={busy}
          onClick={() =>
            void mutate(
              { action: "complete", entryId: tache.id, result: resultat },
              "Tâche terminée.",
            )
          }
        >
          <Check size={15} /> Marquer comme terminée
        </button>
      </section>

      <section className="taskHistory">
        <h3>Historique</h3>
        {[...tache.history].reverse().map((evenement) => (
          <div className="taskHistoryRow" key={evenement.id}>
            <span />
            <div>
              <strong>{evenement.summary}</strong>
              <small>
                {evenement.actorName} · {formatDateTime(evenement.at)}
              </small>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function AttachmentRow({
  task: tache,
  attachment: pieceJointe,
}: {
  task: EntryRecord;
  attachment: EntryAttachment;
}) {
  const [apercu, setPreview] = useState(false);
  const url = attachmentHref(tache, pieceJointe);
  const isImage = pieceJointe.contentType.startsWith("image/");
  const isPdf = pieceJointe.contentType === "application/pdf";
  const canPreview = isImage || isPdf;
  const Icon = isImage ? ImageIcon : FileText;
  return (
    <div className="taskAttachmentRow">
      <span className="taskAttachmentIcon">
        <Icon size={17} />
      </span>
      <div className="taskAttachmentInfo">
        <strong>{pieceJointe.fileName}</strong>
        <small>
          {formatBytes(pieceJointe.sizeBytes)} · {pieceJointe.uploadedByName} ·{" "}
          {formatDateTime(pieceJointe.uploadedAt)}
        </small>
      </div>
      <div className="taskAttachmentActions">
        {canPreview ? (
          <button
            type="button"
            className="secondaryButton"
            onClick={() => setPreview((courant) => !courant)}
          >
            <Eye size={14} /> {apercu ? "Fermer" : "Aperçu"}
          </button>
        ) : null}
        <a href={attachmentHref(tache, pieceJointe, true)} className="secondaryButton">
          <Download size={14} /> Télécharger
        </a>
      </div>
      {apercu ? (
        <div className="taskAttachmentPreview">
          {isImage ? <img src={url} alt={pieceJointe.fileName} /> : null}
          {isPdf ? <iframe title={pieceJointe.fileName} src={url} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskDetailStyles() {
  return (
    <style jsx global>{`
      .taskDetailWorkspace {
        display: grid;
        gap: 16px;
      }
      .taskDetailHeading {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
      }
      .taskDetailHeading h1 {
        margin: 0 0 4px;
        font-size: 27px;
      }
      .taskDetailHeading p {
        margin: 0;
        color: var(--muted);
        font-size: 11px;
      }
      .taskRefreshButton {
        min-height: 36px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #ddd9e8;
        border-radius: 8px;
        background: white;
        color: #5c5765;
        font-size: 11px;
      }
      .taskMessage {
        padding: 10px 12px;
        border-radius: 9px;
        font-size: 11px;
      }
      .taskMessageError {
        border: 1px solid #efc4bc;
        background: #fff5f3;
        color: #a3493a;
      }
      .taskMessageSuccess {
        border: 1px solid #c4e4cf;
        background: #f1faf4;
        color: #347850;
      }
      .taskSummary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .taskSummary > div {
        min-height: 72px;
        padding: 12px 14px;
        display: grid;
        align-content: center;
        gap: 4px;
        border: 1px solid #e8e4ef;
        border-radius: 10px;
        background: white;
      }
      .taskSummary strong {
        font-size: 21px;
        line-height: 1;
      }
      .taskSummary span {
        color: #85808e;
        font-size: 9px;
        font-weight: 700;
      }
      .taskSummary .is-alert strong {
        color: #b34e3d;
      }
      .taskSummary .is-urgent strong {
        color: #ad671e;
      }
      .taskLoading,
      .taskEmpty {
        min-height: 360px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
        color: #85808e;
        text-align: center;
        font-size: 11px;
      }
      .taskEmpty svg {
        color: #4d9b6d;
      }
      .taskEmpty strong {
        color: #5b5664;
        font-size: 14px;
      }
      .taskMasterDetail {
        min-height: 610px;
        display: grid;
        grid-template-columns: minmax(330px, 0.72fr) minmax(560px, 1.65fr);
        gap: 14px;
        align-items: start;
      }
      .taskListPanel,
      .taskDetailPanel {
        min-width: 0;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
        overflow: hidden;
      }
      .taskListPanel {
        max-height: calc(100vh - 275px);
        overflow-y: auto;
      }
      .taskListGroup + .taskListGroup {
        border-top: 1px solid #eeeaf3;
      }
      .taskListGroupTitle {
        min-height: 42px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #fbfaff;
      }
      .taskListGroupTitle strong {
        font-size: 11px;
      }
      .taskListGroupTitle span {
        min-width: 21px;
        padding: 3px 6px;
        border-radius: 999px;
        background: #eeeaf6;
        color: #6d6579;
        text-align: center;
        font-size: 9px;
        font-weight: 800;
      }
      .taskListGroupTitle-overdue {
        background: #fff7f5;
        color: #a94d3e;
      }
      .taskListRow {
        width: 100%;
        padding: 12px 13px;
        display: grid;
        gap: 5px;
        border: 0;
        border-bottom: 1px solid #f0edf4;
        border-left: 3px solid transparent;
        background: white;
        text-align: left;
        color: inherit;
      }
      .taskListRow:hover {
        background: #fbf9ff;
      }
      .taskListRow.isSelected {
        border-left-color: #8065e7;
        background: #f7f4ff;
      }
      .taskListRow.isOverdue:not(.isSelected) {
        border-left-color: #d36a55;
      }
      .taskListRowTop {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .taskListRow > strong {
        font-size: 12px;
        line-height: 1.35;
      }
      .taskListRow > small {
        overflow: hidden;
        color: #8b8693;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .taskDatePill,
      .taskUrgentPill,
      .taskAttachmentPill {
        width: max-content;
        padding: 3px 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 800;
      }
      .taskDatePill {
        background: #f0edf7;
        color: #706a78;
      }
      .taskDatePill-overdue {
        background: #ffe8e3;
        color: #b44f3d;
      }
      .taskDatePill-today {
        background: #eee9ff;
        color: #6e55cc;
      }
      .taskUrgentPill {
        background: #fff0dd;
        color: #a85f18;
      }
      .taskAttachmentPill {
        background: #eef5ff;
        color: #4572a6;
      }
      .taskDetailPanel {
        max-height: calc(100vh - 275px);
        overflow-y: auto;
      }
      .taskDetailContent {
        padding: 18px;
        display: grid;
        gap: 14px;
      }
      .taskDetailHeader {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .taskDetailHeader h2 {
        margin: 7px 0 4px;
        font-size: 20px;
        line-height: 1.3;
      }
      .taskDetailHeader p {
        margin: 0;
        color: #8a8693;
        font-size: 10px;
      }
      .taskDetailBadges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .taskOpenEntries {
        color: #735dd3;
        font-size: 10px;
        font-weight: 750;
        white-space: nowrap;
      }
      .taskOriginBox {
        padding: 12px 13px;
        border: 1px solid #e8e2f2;
        border-radius: 9px;
        background: #faf8ff;
      }
      .taskOriginBox > span {
        color: #7c6ab8;
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .taskOriginBox p {
        margin: 6px 0 0;
        white-space: pre-wrap;
        font-size: 11px;
      }
      .taskDetailSection {
        padding: 14px;
        display: grid;
        gap: 11px;
        border: 1px solid #e9e5f0;
        border-radius: 10px;
      }
      .taskSectionTitle {
        display: flex;
        align-items: center;
        gap: 7px;
        color: #504b59;
        font-size: 12px;
        font-weight: 800;
      }
      .taskField {
        display: grid;
        gap: 5px;
        color: #5b5763;
        font-size: 10px;
        font-weight: 750;
      }
      .taskField textarea,
      .taskField input {
        width: 100%;
        padding: 9px 10px;
        border: 1px solid #dcd8e4;
        border-radius: 8px;
        background: white;
        color: var(--text);
        outline: none;
      }
      .taskField textarea {
        resize: vertical;
        min-height: 64px;
      }
      .taskField textarea:focus,
      .taskField input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
      }
      .taskEditOptions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .taskPriorityButton,
      .taskTagButton {
        min-height: 30px;
        padding: 0 9px;
        border: 1px solid #ddd9e5;
        border-radius: 7px;
        background: white;
        color: #5e5a68;
        font-size: 10px;
      }
      .taskPriorityButton {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .taskPriorityButton.isUrgent {
        border-color: #e5a66d;
        background: #fff2df;
        color: #a55d19;
      }
      .taskTagButton.isSelected {
        border-color: #9d8be7;
        background: #f1edff;
        color: #6551c7;
        font-weight: 750;
      }
      .taskSaveButton {
        width: max-content;
      }
      .taskMuted {
        margin: 0;
        color: #8b8794;
        font-size: 10px;
      }
      .taskAttachments {
        display: grid;
        gap: 7px;
      }
      .taskAttachmentRow {
        padding: 9px 10px;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        gap: 9px;
        align-items: center;
        border: 1px solid #ece8f2;
        border-radius: 8px;
        background: #fdfcff;
      }
      .taskAttachmentIcon {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        background: #eee9ff;
        color: #6f5bc7;
      }
      .taskAttachmentInfo {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .taskAttachmentInfo strong {
        overflow: hidden;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .taskAttachmentInfo small {
        color: #918c99;
        font-size: 8px;
      }
      .taskAttachmentActions {
        display: flex;
        gap: 6px;
      }
      .taskAttachmentActions .secondaryButton {
        min-height: 30px;
        padding: 0 8px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 9px;
      }
      .taskAttachmentPreview {
        grid-column: 1 / -1;
        min-height: 180px;
        padding: 8px;
        overflow: hidden;
        border: 1px solid #e8e3f0;
        border-radius: 8px;
        background: white;
      }
      .taskAttachmentPreview img {
        display: block;
        width: 100%;
        max-height: 520px;
        object-fit: contain;
      }
      .taskAttachmentPreview iframe {
        display: block;
        width: 100%;
        height: 520px;
        border: 0;
        border-radius: 6px;
        background: #f8f7fa;
      }
      .taskUploadBox {
        padding: 10px;
        display: grid;
        gap: 8px;
        border: 1px dashed #d8d1e7;
        border-radius: 8px;
        background: #fbfaff;
      }
      .taskUploadBox > label {
        width: max-content;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #6654bd;
        font-size: 10px;
        font-weight: 750;
        cursor: pointer;
      }
      .taskUploadBox input {
        display: none;
      }
      .taskSelectedFiles {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .taskSelectedFiles > span {
        padding: 4px 7px;
        border-radius: 6px;
        background: #eee9ff;
        color: #6654bd;
        font-size: 9px;
      }
      .taskSelectedFiles .secondaryButton {
        min-height: 30px;
        font-size: 9px;
      }
      .taskCurrentDeadline {
        margin: 0;
        color: #6c6674;
        font-size: 10px;
      }
      .taskPostponeForm {
        display: grid;
        grid-template-columns: minmax(150px, 0.5fr) minmax(220px, 1fr) auto;
        gap: 9px;
        align-items: end;
      }
      .taskPostponeForm .secondaryButton {
        min-height: 38px;
      }
      .taskCompleteSection {
        background: #f9fcfa;
        border-color: #dbece1;
      }
      .taskCompleteButton {
        width: max-content;
        min-height: 36px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #cce4d5;
        border-radius: 8px;
        background: #f2faf5;
        color: #3a8055;
        font-size: 10px;
        font-weight: 750;
      }
      .taskHistory {
        display: grid;
        gap: 8px;
        padding-top: 2px;
      }
      .taskHistory h3 {
        margin: 0 0 2px;
        font-size: 12px;
      }
      .taskHistoryRow {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr);
        gap: 7px;
      }
      .taskHistoryRow > span {
        width: 6px;
        height: 6px;
        margin-top: 5px;
        border-radius: 50%;
        background: #aa9bdd;
      }
      .taskHistoryRow > div {
        display: grid;
        gap: 2px;
      }
      .taskHistoryRow strong {
        font-size: 9px;
        font-weight: 650;
      }
      .taskHistoryRow small {
        color: #96919e;
        font-size: 8px;
      }
      .taskSpin {
        animation: taskSpin 1s linear infinite;
      }
      @keyframes taskSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 1150px) {
        .taskMasterDetail {
          grid-template-columns: minmax(290px, 0.7fr) minmax(450px, 1.3fr);
        }
        .taskPostponeForm {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 900px) {
        .taskSummary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .taskMasterDetail {
          grid-template-columns: 1fr;
        }
        .taskListPanel,
        .taskDetailPanel {
          max-height: none;
        }
      }
      @media (max-width: 620px) {
        .taskDetailHeading,
        .taskDetailHeader {
          flex-direction: column;
        }
        .taskSummary {
          grid-template-columns: 1fr 1fr;
        }
        .taskAttachmentRow {
          grid-template-columns: 34px minmax(0, 1fr);
        }
        .taskAttachmentActions {
          grid-column: 1 / -1;
        }
        .taskAttachmentPreview {
          height: auto;
        }
        .taskAttachmentPreview iframe {
          height: 420px;
        }
      }
    `}</style>
  );
}
