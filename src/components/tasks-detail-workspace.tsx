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

function formatDateOnly(value: string | null): string {
  if (!value) return "Sans date";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day, 12));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function addDaysKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function endOfWeekKey(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return addDaysKey(today, weekday === 0 ? 0 : 7 - weekday);
}

function taskTitle(task: EntryRecord): string {
  return task.nextAction?.trim() || task.structuredDescription?.trim() || task.rawText;
}

function taskSort(a: EntryRecord, b: EntryRecord): number {
  const dateCompare = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
  if (dateCompare !== 0) return dateCompare;
  const urgentCompare = Number(b.priority === "URGENT") - Number(a.priority === "URGENT");
  return urgentCompare || a.createdAt.localeCompare(b.createdAt);
}

function personalTasks(snapshot: TasksSnapshot | null): EntryRecord[] {
  if (!snapshot) return [];
  const actor = normalizePersonName(snapshot.actor.displayName);
  return snapshot.payload.entries
    .filter(
      (entry) =>
        entry.status === "ASSIGNED" &&
        Boolean(entry.assigneeName) &&
        normalizePersonName(entry.assigneeName ?? "") === actor,
    )
    .sort(taskSort);
}

function groupTasks(tasks: EntryRecord[], now: Date): TaskGroup[] {
  const today = parisDateKey(now);
  const endOfWeek = endOfWeekKey(today);
  const buckets: Record<TaskGroupKey, EntryRecord[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    undated: [],
  };

  for (const task of tasks) {
    if (!task.dueDate) buckets.undated.push(task);
    else if (task.dueDate < today) buckets.overdue.push(task);
    else if (task.dueDate === today) buckets.today.push(task);
    else if (task.dueDate <= endOfWeek) buckets.week.push(task);
    else buckets.later.push(task);
  }

  return (["overdue", "today", "week", "later", "undated"] as TaskGroupKey[])
    .map((key) => ({ key, label: groupLabels[key], tasks: buckets[key] }))
    .filter((group) => group.tasks.length > 0);
}

function attachmentHref(task: EntryRecord, attachment: EntryAttachment, download = false): string {
  return `/api/desktop/entries/${task.id}/attachments/${attachment.id}${download ? "?download=1" : ""}`;
}

function useTasksData() {
  const [snapshot, setSnapshot] = useState<TasksSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/entries", { cache: "no-store" });
      const body = (await response.json()) as TasksSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "TASKS_LOAD_FAILED");
      setSnapshot(body);
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

  const mutate = useCallback(
    async (body: MutationBody, successMessage: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch("/api/desktop/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = (await response.json()) as TasksSnapshot & { error?: string };
        if (!response.ok) {
          throw new Error(
            errorMessages[result.error ?? ""] ?? "L'action sur la tâche n'a pas pu être enregistrée.",
          );
        }
        setSnapshot(result);
        setNotice(successMessage);
        return true;
      } catch (mutationError) {
        setError(
          mutationError instanceof Error ? mutationError.message : "L'action n'a pas pu être enregistrée.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const upload = useCallback(async (entryId: string, files: File[]) => {
    if (files.length === 0) return true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const response = await fetch(`/api/desktop/entries/${entryId}/attachments`, {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as TasksSnapshot & { error?: string };
      if (!response.ok) {
        throw new Error(
          errorMessages[result.error ?? ""] ?? "Les pièces jointes n'ont pas pu être ajoutées.",
        );
      }
      setSnapshot(result);
      setNotice(`${files.length} pièce${files.length > 1 ? "s" : ""} jointe${files.length > 1 ? "s" : ""} ajoutée${files.length > 1 ? "s" : ""}.`);
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

  return { snapshot, loading, busy, error, notice, load, mutate, upload };
}

export function TasksDetailWorkspace() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const { snapshot, loading, busy, error, notice, load, mutate, upload } = useTasksData();
  const [selectedId, setSelectedId] = useState<string | null>(focusId);

  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const tasks = useMemo(() => personalTasks(snapshot), [snapshot]);
  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now]);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;
  const today = parisDateKey(now);
  const overdueCount = tasks.filter((task) => isAssignedOverdue(task, now)).length;
  const todayCount = tasks.filter((task) => task.dueDate === today).length;
  const urgentCount = tasks.filter((task) => task.priority === "URGENT").length;

  useEffect(() => {
    if (focusId && tasks.some((task) => task.id === focusId)) {
      setSelectedId(focusId);
      return;
    }
    if (!selectedId || !tasks.some((task) => task.id === selectedId)) {
      setSelectedId(tasks[0]?.id ?? null);
    }
  }, [focusId, selectedId, tasks]);

  return (
    <div className="taskDetailWorkspace">
      <section className="taskDetailHeading">
        <div>
          <h1>Mes tâches</h1>
          <p>Clique sur une tâche pour consulter ses pièces jointes et modifier ses informations.</p>
        </div>
        <button type="button" className="taskRefreshButton" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </section>

      {error ? <div className="taskMessage taskMessageError">{error}</div> : null}
      {notice ? <div className="taskMessage taskMessageSuccess">{notice}</div> : null}

      <section className="taskSummary" aria-label="Résumé des tâches">
        <SummaryCard value={tasks.length} label="Actives" />
        <SummaryCard value={overdueCount} label="En retard" tone={overdueCount > 0 ? "alert" : undefined} />
        <SummaryCard value={todayCount} label="Aujourd'hui" />
        <SummaryCard value={urgentCount} label="Urgentes" tone={urgentCount > 0 ? "urgent" : undefined} />
      </section>

      {loading && !snapshot ? (
        <div className="taskLoading">
          <RefreshCw size={18} className="taskSpin" /> Chargement des tâches…
        </div>
      ) : tasks.length === 0 ? (
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
                {group.tasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className={`taskListRow${task.id === selectedTask?.id ? " isSelected" : ""}${group.key === "overdue" ? " isOverdue" : ""}`}
                    onClick={() => setSelectedId(task.id)}
                  >
                    <div className="taskListRowTop">
                      <span className={`taskDatePill taskDatePill-${group.key}`}>
                        <CalendarClock size={11} /> {formatDateOnly(task.dueDate)}
                      </span>
                      {task.priority === "URGENT" ? <span className="taskUrgentPill">Urgent</span> : null}
                      {task.attachments.length > 0 ? (
                        <span className="taskAttachmentPill"><Paperclip size={10} /> {task.attachments.length}</span>
                      ) : null}
                    </div>
                    <strong>{taskTitle(task)}</strong>
                    <small>{task.rawText}</small>
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
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "alert" | "urgent";
}) {
  return (
    <div className={tone ? `is-${tone}` : ""}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TaskDetail({
  task,
  tags,
  busy,
  mutate,
  upload,
}: {
  task: EntryRecord;
  tags: EntriesTag[];
  busy: boolean;
  mutate: (body: MutationBody, successMessage: string) => Promise<boolean>;
  upload: (entryId: string, files: File[]) => Promise<boolean>;
}) {
  const [description, setDescription] = useState(task.structuredDescription ?? task.rawText);
  const [nextAction, setNextAction] = useState(task.nextAction ?? task.rawText);
  const [priority, setPriority] = useState<"NORMAL" | "URGENT">(task.priority);
  const [tagIds, setTagIds] = useState<string[]>(task.tagIds);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");
  const [result, setResult] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const visibleTags = tags
    .filter((tag) => tag.active || tagIds.includes(tag.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  async function saveDetails() {
    await mutate(
      {
        action: "updateAssigned",
        entryId: task.id,
        description,
        nextAction,
        priority,
        tagIds,
      },
      "Informations de la tâche enregistrées.",
    );
  }

  async function submitPostpone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await mutate(
      {
        action: "postpone",
        entryId: task.id,
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
    if (files.length === 0) return;
    const ok = await upload(task.id, files);
    if (ok) setFiles([]);
  }

  return (
    <div className="taskDetailContent">
      <header className="taskDetailHeader">
        <div>
          <div className="taskDetailBadges">
            <span className="taskDatePill"><CalendarClock size={12} /> {formatDateOnly(task.dueDate)}</span>
            {task.priority === "URGENT" ? <span className="taskUrgentPill">Urgent</span> : null}
          </div>
          <h2>{taskTitle(task)}</h2>
          <p>Responsable : <strong>{task.assigneeName}</strong></p>
        </div>
        <Link href="/entrees" className="taskOpenEntries">Ouvrir Entrées</Link>
      </header>

      <section className="taskOriginBox">
        <span>Texte d&apos;origine</span>
        <p>{task.rawText}</p>
      </section>

      <TaskCommercialBridge task={task} description={description} nextAction={nextAction} />

      <section className="taskDetailSection">
        <div className="taskSectionTitle"><Save size={15} /> Modifier la tâche</div>
        <label className="taskField">
          <span>C&apos;est quoi ?</span>
          <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="taskField">
          <span>J&apos;en fais quoi ?</span>
          <textarea rows={3} value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
        </label>

        <div className="taskEditOptions">
          <button
            type="button"
            className={`taskPriorityButton${priority === "URGENT" ? " isUrgent" : ""}`}
            onClick={() => setPriority((current) => (current === "URGENT" ? "NORMAL" : "URGENT"))}
          >
            <AlertTriangle size={13} /> {priority === "URGENT" ? "Urgent" : "Passer en urgent"}
          </button>
          {visibleTags.map((tag) => (
            <button
              type="button"
              key={tag.id}
              className={`taskTagButton${tagIds.includes(tag.id) ? " isSelected" : ""}`}
              onClick={() =>
                setTagIds((current) =>
                  current.includes(tag.id)
                    ? current.filter((tagId) => tagId !== tag.id)
                    : [...current, tag.id],
                )
              }
            >
              {tag.label}{!tag.active ? " (désactivé)" : ""}
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
        <div className="taskSectionTitle"><Paperclip size={15} /> Pièces jointes ({task.attachments.length})</div>
        {task.attachments.length === 0 ? (
          <p className="taskMuted">Aucune pièce jointe sur cette tâche.</p>
        ) : (
          <div className="taskAttachments">
            {task.attachments.map((attachment) => (
              <AttachmentRow key={attachment.id} task={task} attachment={attachment} />
            ))}
          </div>
        )}
        <div className="taskUploadBox">
          <label>
            <Upload size={14} /> Ajouter des photos ou documents
            <input
              type="file"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              disabled={busy}
            />
          </label>
          {files.length > 0 ? (
            <div className="taskSelectedFiles">
              {files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => void submitFiles()}>
                Envoyer {files.length} pièce{files.length > 1 ? "s" : ""}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="taskDetailSection">
        <div className="taskSectionTitle"><Clock3 size={15} /> Échéance</div>
        <p className="taskCurrentDeadline">Échéance actuelle : <strong>{formatDateOnly(task.dueDate)}</strong></p>
        <form className="taskPostponeForm" onSubmit={(event) => void submitPostpone(event)}>
          <label className="taskField">
            <span>Nouvelle échéance</span>
            <input
              type="date"
              min={task.dueDate ? addDaysKey(task.dueDate, 1) : undefined}
              value={postponeDate}
              onChange={(event) => setPostponeDate(event.target.value)}
              required
            />
          </label>
          <label className="taskField">
            <span>Motif obligatoire</span>
            <input
              value={postponeReason}
              onChange={(event) => setPostponeReason(event.target.value)}
              placeholder="Pourquoi la date est repoussée ?"
              required
            />
          </label>
          <button type="submit" className="secondaryButton" disabled={busy || !postponeDate || !postponeReason.trim()}>
            Reporter l&apos;échéance
          </button>
        </form>
      </section>

      <section className="taskDetailSection taskCompleteSection">
        <div className="taskSectionTitle"><Check size={15} /> Terminer</div>
        <label className="taskField">
          <span>Résultat facultatif</span>
          <textarea rows={2} value={result} onChange={(event) => setResult(event.target.value)} />
        </label>
        <button
          type="button"
          className="taskCompleteButton"
          disabled={busy}
          onClick={() => void mutate({ action: "complete", entryId: task.id, result }, "Tâche terminée.")}
        >
          <Check size={15} /> Marquer comme terminée
        </button>
      </section>

      <section className="taskHistory">
        <h3>Historique</h3>
        {[...task.history].reverse().map((event) => (
          <div className="taskHistoryRow" key={event.id}>
            <span />
            <div>
              <strong>{event.summary}</strong>
              <small>{event.actorName} · {formatDateTime(event.at)}</small>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function AttachmentRow({ task, attachment }: { task: EntryRecord; attachment: EntryAttachment }) {
  const [preview, setPreview] = useState(false);
  const url = attachmentHref(task, attachment);
  const isImage = attachment.contentType.startsWith("image/");
  const isPdf = attachment.contentType === "application/pdf";
  const canPreview = isImage || isPdf;
  const Icon = isImage ? ImageIcon : FileText;
  return (
    <div className="taskAttachmentRow">
      <span className="taskAttachmentIcon"><Icon size={17} /></span>
      <div className="taskAttachmentInfo">
        <strong>{attachment.fileName}</strong>
        <small>{formatBytes(attachment.sizeBytes)} · {attachment.uploadedByName} · {formatDateTime(attachment.uploadedAt)}</small>
      </div>
      <div className="taskAttachmentActions">
        {canPreview ? (
          <button type="button" className="secondaryButton" onClick={() => setPreview((current) => !current)}>
            <Eye size={14} /> {preview ? "Fermer" : "Aperçu"}
          </button>
        ) : null}
        <a href={attachmentHref(task, attachment, true)} className="secondaryButton">
          <Download size={14} /> Télécharger
        </a>
      </div>
      {preview ? (
        <div className="taskAttachmentPreview">
          {isImage ? <img src={url} alt={attachment.fileName} /> : null}
          {isPdf ? <iframe title={attachment.fileName} src={url} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskDetailStyles() {
  return (
    <style jsx global>{`
      .taskDetailWorkspace { display: grid; gap: 16px; }
      .taskDetailHeading { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
      .taskDetailHeading h1 { margin: 0 0 4px; font-size: 27px; }
      .taskDetailHeading p { margin: 0; color: var(--muted); font-size: 11px; }
      .taskRefreshButton { min-height: 36px; padding: 0 11px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #ddd9e8; border-radius: 8px; background: white; color: #5c5765; font-size: 11px; }
      .taskMessage { padding: 10px 12px; border-radius: 9px; font-size: 11px; }
      .taskMessageError { border: 1px solid #efc4bc; background: #fff5f3; color: #a3493a; }
      .taskMessageSuccess { border: 1px solid #c4e4cf; background: #f1faf4; color: #347850; }
      .taskSummary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .taskSummary > div { min-height: 72px; padding: 12px 14px; display: grid; align-content: center; gap: 4px; border: 1px solid #e8e4ef; border-radius: 10px; background: white; }
      .taskSummary strong { font-size: 21px; line-height: 1; }
      .taskSummary span { color: #85808e; font-size: 9px; font-weight: 700; }
      .taskSummary .is-alert strong { color: #b34e3d; }
      .taskSummary .is-urgent strong { color: #ad671e; }
      .taskLoading, .taskEmpty { min-height: 360px; display: grid; place-items: center; align-content: center; gap: 8px; border: 1px solid #e8e4ef; border-radius: 12px; background: white; color: #85808e; text-align: center; font-size: 11px; }
      .taskEmpty svg { color: #4d9b6d; }
      .taskEmpty strong { color: #5b5664; font-size: 14px; }
      .taskMasterDetail { min-height: 610px; display: grid; grid-template-columns: minmax(330px, .72fr) minmax(560px, 1.65fr); gap: 14px; align-items: start; }
      .taskListPanel, .taskDetailPanel { min-width: 0; border: 1px solid #e8e4ef; border-radius: 12px; background: white; overflow: hidden; }
      .taskListPanel { max-height: calc(100vh - 275px); overflow-y: auto; }
      .taskListGroup + .taskListGroup { border-top: 1px solid #eeeaf3; }
      .taskListGroupTitle { min-height: 42px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; background: #fbfaff; }
      .taskListGroupTitle strong { font-size: 11px; }
      .taskListGroupTitle span { min-width: 21px; padding: 3px 6px; border-radius: 999px; background: #eeeaf6; color: #6d6579; text-align: center; font-size: 9px; font-weight: 800; }
      .taskListGroupTitle-overdue { background: #fff7f5; color: #a94d3e; }
      .taskListRow { width: 100%; padding: 12px 13px; display: grid; gap: 5px; border: 0; border-bottom: 1px solid #f0edf4; border-left: 3px solid transparent; background: white; text-align: left; color: inherit; }
      .taskListRow:hover { background: #fbf9ff; }
      .taskListRow.isSelected { border-left-color: #8065e7; background: #f7f4ff; }
      .taskListRow.isOverdue:not(.isSelected) { border-left-color: #d36a55; }
      .taskListRowTop { display: flex; flex-wrap: wrap; gap: 5px; }
      .taskListRow > strong { font-size: 12px; line-height: 1.35; }
      .taskListRow > small { overflow: hidden; color: #8b8693; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
      .taskDatePill, .taskUrgentPill, .taskAttachmentPill { width: max-content; padding: 3px 6px; display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; font-size: 8px; font-weight: 800; }
      .taskDatePill { background: #f0edf7; color: #706a78; }
      .taskDatePill-overdue { background: #ffe8e3; color: #b44f3d; }
      .taskDatePill-today { background: #eee9ff; color: #6e55cc; }
      .taskUrgentPill { background: #fff0dd; color: #a85f18; }
      .taskAttachmentPill { background: #eef5ff; color: #4572a6; }
      .taskDetailPanel { max-height: calc(100vh - 275px); overflow-y: auto; }
      .taskDetailContent { padding: 18px; display: grid; gap: 14px; }
      .taskDetailHeader { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .taskDetailHeader h2 { margin: 7px 0 4px; font-size: 20px; line-height: 1.3; }
      .taskDetailHeader p { margin: 0; color: #8a8693; font-size: 10px; }
      .taskDetailBadges { display: flex; flex-wrap: wrap; gap: 6px; }
      .taskOpenEntries { color: #735dd3; font-size: 10px; font-weight: 750; white-space: nowrap; }
      .taskOriginBox { padding: 12px 13px; border: 1px solid #e8e2f2; border-radius: 9px; background: #faf8ff; }
      .taskOriginBox > span { color: #7c6ab8; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
      .taskOriginBox p { margin: 6px 0 0; white-space: pre-wrap; font-size: 11px; }
      .taskDetailSection { padding: 14px; display: grid; gap: 11px; border: 1px solid #e9e5f0; border-radius: 10px; }
      .taskSectionTitle { display: flex; align-items: center; gap: 7px; color: #504b59; font-size: 12px; font-weight: 800; }
      .taskField { display: grid; gap: 5px; color: #5b5763; font-size: 10px; font-weight: 750; }
      .taskField textarea, .taskField input { width: 100%; padding: 9px 10px; border: 1px solid #dcd8e4; border-radius: 8px; background: white; color: var(--text); outline: none; }
      .taskField textarea { resize: vertical; min-height: 64px; }
      .taskField textarea:focus, .taskField input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent); }
      .taskEditOptions { display: flex; flex-wrap: wrap; gap: 6px; }
      .taskPriorityButton, .taskTagButton { min-height: 30px; padding: 0 9px; border: 1px solid #ddd9e5; border-radius: 7px; background: white; color: #5e5a68; font-size: 10px; }
      .taskPriorityButton { display: inline-flex; align-items: center; gap: 5px; }
      .taskPriorityButton.isUrgent { border-color: #e5a66d; background: #fff2df; color: #a55d19; }
      .taskTagButton.isSelected { border-color: #9d8be7; background: #f1edff; color: #6551c7; font-weight: 750; }
      .taskSaveButton { width: max-content; }
      .taskMuted { margin: 0; color: #8b8794; font-size: 10px; }
      .taskAttachments { display: grid; gap: 7px; }
      .taskAttachmentRow { padding: 9px 10px; display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 9px; align-items: center; border: 1px solid #ece8f2; border-radius: 8px; background: #fdfcff; }
      .taskAttachmentIcon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; background: #eee9ff; color: #6f5bc7; }
      .taskAttachmentInfo { min-width: 0; display: grid; gap: 2px; }
      .taskAttachmentInfo strong { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      .taskAttachmentInfo small { color: #918c99; font-size: 8px; }
      .taskAttachmentActions { display: flex; gap: 6px; }
      .taskAttachmentActions .secondaryButton { min-height: 30px; padding: 0 8px; display: inline-flex; align-items: center; gap: 5px; font-size: 9px; }
      .taskAttachmentPreview { grid-column: 1 / -1; min-height: 180px; padding: 8px; overflow: hidden; border: 1px solid #e8e3f0; border-radius: 8px; background: white; }
      .taskAttachmentPreview img { display: block; width: 100%; max-height: 520px; object-fit: contain; }
      .taskAttachmentPreview iframe { display: block; width: 100%; height: 520px; border: 0; border-radius: 6px; background: #f8f7fa; }
      .taskUploadBox { padding: 10px; display: grid; gap: 8px; border: 1px dashed #d8d1e7; border-radius: 8px; background: #fbfaff; }
      .taskUploadBox > label { width: max-content; display: inline-flex; align-items: center; gap: 6px; color: #6654bd; font-size: 10px; font-weight: 750; cursor: pointer; }
      .taskUploadBox input { display: none; }
      .taskSelectedFiles { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .taskSelectedFiles > span { padding: 4px 7px; border-radius: 6px; background: #eee9ff; color: #6654bd; font-size: 9px; }
      .taskSelectedFiles .secondaryButton { min-height: 30px; font-size: 9px; }
      .taskCurrentDeadline { margin: 0; color: #6c6674; font-size: 10px; }
      .taskPostponeForm { display: grid; grid-template-columns: minmax(150px, .5fr) minmax(220px, 1fr) auto; gap: 9px; align-items: end; }
      .taskPostponeForm .secondaryButton { min-height: 38px; }
      .taskCompleteSection { background: #f9fcfa; border-color: #dbece1; }
      .taskCompleteButton { width: max-content; min-height: 36px; padding: 0 11px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #cce4d5; border-radius: 8px; background: #f2faf5; color: #3a8055; font-size: 10px; font-weight: 750; }
      .taskHistory { display: grid; gap: 8px; padding-top: 2px; }
      .taskHistory h3 { margin: 0 0 2px; font-size: 12px; }
      .taskHistoryRow { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 7px; }
      .taskHistoryRow > span { width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; background: #aa9bdd; }
      .taskHistoryRow > div { display: grid; gap: 2px; }
      .taskHistoryRow strong { font-size: 9px; font-weight: 650; }
      .taskHistoryRow small { color: #96919e; font-size: 8px; }
      .taskSpin { animation: taskSpin 1s linear infinite; }
      @keyframes taskSpin { to { transform: rotate(360deg); } }
      @media (max-width: 1150px) {
        .taskMasterDetail { grid-template-columns: minmax(290px, .7fr) minmax(450px, 1.3fr); }
        .taskPostponeForm { grid-template-columns: 1fr; }
      }
      @media (max-width: 900px) {
        .taskSummary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .taskMasterDetail { grid-template-columns: 1fr; }
        .taskListPanel, .taskDetailPanel { max-height: none; }
      }
      @media (max-width: 620px) {
        .taskDetailHeading, .taskDetailHeader { flex-direction: column; }
        .taskSummary { grid-template-columns: 1fr 1fr; }
        .taskAttachmentRow { grid-template-columns: 34px minmax(0, 1fr); }
        .taskAttachmentActions { grid-column: 1 / -1; }
        .taskAttachmentPreview { height: auto; }
        .taskAttachmentPreview iframe { height: 420px; }
      }
    `}</style>
  );
}
