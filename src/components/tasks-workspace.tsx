"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  isAssignedOverdue,
  normalizePersonName,
  parisDateKey,
  type EntriesPayload,
  type EntryRecord,
} from "@/lib/entries/domain";

type TasksSnapshot = {
  payload: EntriesPayload;
  actor: { userId: string; displayName: string };
  serverNow: string;
};

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
  const daysUntilSunday = weekday === 0 ? 0 : 7 - weekday;
  return addDaysKey(today, daysUntilSunday);
}

function taskTitle(task: EntryRecord): string {
  return task.nextAction?.trim() || task.structuredDescription?.trim() || task.rawText;
}

function taskContext(task: EntryRecord): string | null {
  const title = taskTitle(task);
  if (task.rawText.trim() !== title) return task.rawText;
  const structured = task.structuredDescription?.trim();
  return structured && structured !== title ? structured : null;
}

function taskSort(a: EntryRecord, b: EntryRecord): number {
  const dateCompare = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
  if (dateCompare !== 0) return dateCompare;
  const urgentCompare = Number(b.priority === "URGENT") - Number(a.priority === "URGENT");
  if (urgentCompare !== 0) return urgentCompare;
  return a.createdAt.localeCompare(b.createdAt);
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
    if (!task.dueDate) {
      buckets.undated.push(task);
    } else if (task.dueDate < today) {
      buckets.overdue.push(task);
    } else if (task.dueDate === today) {
      buckets.today.push(task);
    } else if (task.dueDate <= endOfWeek) {
      buckets.week.push(task);
    } else {
      buckets.later.push(task);
    }
  }

  return (["overdue", "today", "week", "later", "undated"] as TaskGroupKey[])
    .map((key) => ({ key, label: groupLabels[key], tasks: buckets[key] }))
    .filter((group) => group.tasks.length > 0);
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
    async (body: Record<string, unknown> & { action: string }, successMessage: string) => {
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
        const message = mutationError instanceof Error ? mutationError.message : "L'action a échoué.";
        setError(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { snapshot, loading, busy, error, notice, load, mutate };
}

export function DashboardTasksPanel() {
  const { snapshot, loading, busy, error, load, mutate } = useTasksData();
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const tasks = useMemo(() => personalTasks(snapshot), [snapshot]);
  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now]);
  const visibleTasks = groups.flatMap((group) =>
    group.tasks.map((task) => ({ task, group: group.key, groupLabel: group.label })),
  ).slice(0, 6);

  return (
    <article className="dashboardPanel dashboardTasksPanel">
      <div className="dashboardPanelHeader">
        <div>
          <h2 className="dashboardTasksTitle">
            <ListTodo size={16} /> Mes tâches
            {!loading ? <span className="dashboardTasksCount">{tasks.length}</span> : null}
          </h2>
          <p>Mes actions actives, triées par échéance</p>
        </div>
        <Link href="/tasks">Voir tout</Link>
      </div>

      {loading && !snapshot ? (
        <div className="dashboardTasksLoading">
          <RefreshCw size={16} className="tasksSpin" /> Chargement…
        </div>
      ) : error ? (
        <div className="dashboardTasksError">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Réessayer</button>
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="dashboardTasksEmpty">
          <CheckCircle2 size={28} />
          <strong>Rien à faire pour le moment</strong>
          <span>Aucune tâche active ne t'est affectée.</span>
        </div>
      ) : (
        <div className="dashboardTasksList">
          {visibleTasks.map(({ task, group, groupLabel }) => (
            <div
              className={`dashboardTaskRow${group === "overdue" ? " isOverdue" : ""}`}
              key={task.id}
            >
              <Link href={`/tasks?focus=${task.id}`} className="dashboardTaskMain">
                <div className="dashboardTaskTopline">
                  <span className={`dashboardTaskGroup dashboardTaskGroup-${group}`}>{groupLabel}</span>
                  {task.priority === "URGENT" ? (
                    <span className="tasksBadge tasksBadgeUrgent">Urgent</span>
                  ) : null}
                </div>
                <strong>{taskTitle(task)}</strong>
                <span className="dashboardTaskContext">{taskContext(task) ?? "Action PAPOT"}</span>
                <small>
                  <Clock3 size={11} /> {formatDateOnly(task.dueDate)}
                </small>
              </Link>
              <button
                type="button"
                className="dashboardTaskDone"
                title="Terminer"
                aria-label={`Terminer ${taskTitle(task)}`}
                disabled={busy}
                onClick={() =>
                  void mutate(
                    { action: "complete", entryId: task.id, result: "" },
                    "Tâche terminée.",
                  )
                }
              >
                <Check size={15} />
              </button>
            </div>
          ))}
          {tasks.length > visibleTasks.length ? (
            <Link href="/tasks" className="dashboardTasksMore">
              + {tasks.length - visibleTasks.length} autre{tasks.length - visibleTasks.length > 1 ? "s" : ""} tâche{tasks.length - visibleTasks.length > 1 ? "s" : ""}
              <ChevronRight size={13} />
            </Link>
          ) : null}
        </div>
      )}

      <TasksStyles />
    </article>
  );
}

export function TasksWorkspace() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const { snapshot, loading, busy, error, notice, load, mutate } = useTasksData();
  const [postponeId, setPostponeId] = useState<string | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");

  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const tasks = useMemo(() => personalTasks(snapshot), [snapshot]);
  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now]);
  const today = parisDateKey(now);
  const overdueCount = tasks.filter((task) => isAssignedOverdue(task, now)).length;
  const todayCount = tasks.filter((task) => task.dueDate === today).length;
  const urgentCount = tasks.filter((task) => task.priority === "URGENT").length;

  useEffect(() => {
    if (!focusId || loading) return;
    const element = document.getElementById(`task-${focusId}`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, loading, tasks.length]);

  async function submitPostpone(event: FormEvent<HTMLFormElement>, task: EntryRecord) {
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
      setPostponeId(null);
      setPostponeDate("");
      setPostponeReason("");
    }
  }

  return (
    <div className="tasksWorkspace">
      <section className="tasksPageHeading">
        <div>
          <h1>Mes tâches</h1>
          <p>Toutes les actions actives qui te sont affectées, dans l'ordre des échéances.</p>
        </div>
        <button type="button" className="tasksRefreshButton" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} /> Actualiser
        </button>
      </section>

      {error ? <div className="tasksMessage tasksMessageError">{error}</div> : null}
      {notice ? <div className="tasksMessage tasksMessageSuccess">{notice}</div> : null}

      <section className="tasksSummary" aria-label="Résumé des tâches">
        <div><strong>{tasks.length}</strong><span>Actives</span></div>
        <div className={overdueCount > 0 ? "isAlert" : ""}><strong>{overdueCount}</strong><span>En retard</span></div>
        <div><strong>{todayCount}</strong><span>Aujourd'hui</span></div>
        <div className={urgentCount > 0 ? "isUrgent" : ""}><strong>{urgentCount}</strong><span>Urgentes</span></div>
      </section>

      {loading && !snapshot ? (
        <div className="tasksLoading"><RefreshCw size={18} className="tasksSpin" /> Chargement des tâches…</div>
      ) : tasks.length === 0 ? (
        <div className="tasksAllDone">
          <CheckCircle2 size={34} />
          <strong>Aucune tâche active</strong>
          <span>Les tâches terminées restent conservées dans l'historique des Entrées.</span>
        </div>
      ) : (
        <div className="tasksGroups">
          {groups.map((group) => (
            <section className={`tasksGroup tasksGroup-${group.key}`} key={group.key}>
              <div className="tasksGroupHeader">
                <h2>{group.label}</h2>
                <span>{group.tasks.length}</span>
              </div>
              <div className="tasksGroupList">
                {group.tasks.map((task) => {
                  const focused = task.id === focusId;
                  const context = taskContext(task);
                  return (
                    <article
                      id={`task-${task.id}`}
                      key={task.id}
                      className={`tasksCard${focused ? " isFocused" : ""}${group.key === "overdue" ? " isOverdue" : ""}`}
                    >
                      <div className="tasksCardMain">
                        <div className="tasksCardBadges">
                          <span className={`tasksBadge tasksBadgeDate tasksBadgeDate-${group.key}`}>
                            <CalendarClock size={12} /> {formatDateOnly(task.dueDate)}
                          </span>
                          {task.priority === "URGENT" ? <span className="tasksBadge tasksBadgeUrgent">Urgent</span> : null}
                          {group.key === "overdue" ? <span className="tasksBadge tasksBadgeLate">En retard</span> : null}
                        </div>
                        <h3>{taskTitle(task)}</h3>
                        {context ? <p>{context}</p> : null}
                        <div className="tasksCardMeta">
                          {task.structuredDescription && task.structuredDescription !== taskTitle(task) ? (
                            <span>{task.structuredDescription}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="tasksCardActions">
                        <button
                          type="button"
                          className="tasksCompleteButton"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              { action: "complete", entryId: task.id, result: "" },
                              "Tâche terminée.",
                            )
                          }
                        >
                          <Check size={15} /> Terminer
                        </button>
                        <button
                          type="button"
                          className="tasksPostponeButton"
                          disabled={busy}
                          onClick={() => {
                            if (postponeId === task.id) {
                              setPostponeId(null);
                              return;
                            }
                            setPostponeId(task.id);
                            setPostponeDate("");
                            setPostponeReason("");
                          }}
                        >
                          <Clock3 size={15} /> Reporter
                        </button>
                      </div>

                      {postponeId === task.id ? (
                        <form className="tasksPostponeForm" onSubmit={(event) => void submitPostpone(event, task)}>
                          <label>
                            <span>Nouvelle échéance</span>
                            <input
                              type="date"
                              min={task.dueDate ? addDaysKey(task.dueDate, 1) : undefined}
                              value={postponeDate}
                              onChange={(event) => setPostponeDate(event.target.value)}
                              required
                            />
                          </label>
                          <label>
                            <span>Motif du report</span>
                            <input
                              value={postponeReason}
                              onChange={(event) => setPostponeReason(event.target.value)}
                              placeholder="Pourquoi la date est repoussée ?"
                              required
                            />
                          </label>
                          <button
                            type="submit"
                            className="primaryButton"
                            disabled={busy || !postponeDate || !postponeReason.trim()}
                          >
                            Valider le report
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <TasksStyles />
    </div>
  );
}

function TasksStyles() {
  return (
    <style jsx global>{`
      .dashboardTasksPanel {
        min-height: 250px;
      }
      .dashboardTasksTitle {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .dashboardTasksCount {
        min-width: 20px;
        padding: 2px 6px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        background: #eee9ff;
        color: #6954c8;
        font-size: 9px;
      }
      .dashboardTasksLoading,
      .dashboardTasksEmpty,
      .dashboardTasksError {
        min-height: 165px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        text-align: center;
        color: #85808e;
        font-size: 10px;
      }
      .dashboardTasksEmpty strong {
        color: #5d5866;
        font-size: 12px;
      }
      .dashboardTasksEmpty svg {
        color: #4c9b6c;
      }
      .dashboardTasksError {
        color: #9d493d;
      }
      .dashboardTasksError button {
        min-height: 30px;
        padding: 0 9px;
        border: 1px solid #e3b9b1;
        border-radius: 7px;
        background: white;
        color: #9d493d;
      }
      .dashboardTasksList {
        display: grid;
        gap: 7px;
        padding-top: 12px;
      }
      .dashboardTaskRow {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 34px;
        gap: 8px;
        align-items: center;
        border: 1px solid #ece8f2;
        border-radius: 9px;
        background: #fdfcff;
        overflow: hidden;
      }
      .dashboardTaskRow.isOverdue {
        border-color: #efc4bc;
        background: #fff9f7;
      }
      .dashboardTaskMain {
        min-width: 0;
        padding: 9px 10px;
        display: grid;
        gap: 3px;
      }
      .dashboardTaskTopline {
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .dashboardTaskGroup {
        color: #7d7787;
        font-size: 8px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .dashboardTaskGroup-overdue {
        color: #b34e3d;
      }
      .dashboardTaskGroup-today {
        color: #7155ce;
      }
      .dashboardTaskMain > strong {
        overflow: hidden;
        color: #47434d;
        font-size: 11px;
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dashboardTaskContext {
        overflow: hidden;
        color: #8a8592;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dashboardTaskMain small {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: #8a8592;
        font-size: 8px;
      }
      .dashboardTaskDone {
        width: 28px;
        height: 28px;
        padding: 0;
        display: grid;
        place-items: center;
        border: 1px solid #d5e5db;
        border-radius: 50%;
        background: #f3fbf6;
        color: #3d8a5c;
      }
      .dashboardTaskDone:hover {
        background: #e7f6ec;
      }
      .dashboardTasksMore {
        min-height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        color: #725bd4;
        font-size: 9px;
        font-weight: 750;
      }

      .tasksWorkspace {
        display: grid;
        gap: 16px;
      }
      .tasksPageHeading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
      }
      .tasksPageHeading h1 {
        margin: 0 0 4px;
        font-size: 27px;
      }
      .tasksPageHeading p {
        margin: 0;
        color: var(--muted);
        font-size: 11px;
      }
      .tasksRefreshButton {
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
      .tasksMessage {
        padding: 10px 12px;
        border-radius: 9px;
        font-size: 11px;
      }
      .tasksMessageError {
        border: 1px solid #efc4bc;
        background: #fff5f3;
        color: #a3493a;
      }
      .tasksMessageSuccess {
        border: 1px solid #c4e4cf;
        background: #f1faf4;
        color: #347850;
      }
      .tasksSummary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .tasksSummary > div {
        min-height: 72px;
        padding: 12px 14px;
        display: grid;
        align-content: center;
        gap: 4px;
        border: 1px solid #e8e4ef;
        border-radius: 10px;
        background: white;
      }
      .tasksSummary strong {
        font-size: 21px;
        line-height: 1;
      }
      .tasksSummary span {
        color: #85808e;
        font-size: 9px;
        font-weight: 700;
      }
      .tasksSummary .isAlert strong {
        color: #b34e3d;
      }
      .tasksSummary .isUrgent strong {
        color: #ad671e;
      }
      .tasksLoading,
      .tasksAllDone {
        min-height: 350px;
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
      .tasksAllDone svg {
        color: #4d9b6d;
      }
      .tasksAllDone strong {
        color: #5b5664;
        font-size: 14px;
      }
      .tasksGroups {
        display: grid;
        gap: 15px;
      }
      .tasksGroup {
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
        overflow: hidden;
      }
      .tasksGroup-overdue {
        border-color: #eac8c1;
      }
      .tasksGroupHeader {
        min-height: 44px;
        padding: 0 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #eeeaf3;
        background: #fbfaff;
      }
      .tasksGroup-overdue .tasksGroupHeader {
        background: #fff7f5;
      }
      .tasksGroupHeader h2 {
        margin: 0;
        font-size: 12px;
      }
      .tasksGroupHeader > span {
        min-width: 22px;
        padding: 3px 6px;
        border-radius: 999px;
        background: #eeeaf6;
        color: #6d6579;
        text-align: center;
        font-size: 9px;
        font-weight: 800;
      }
      .tasksGroupList {
        display: grid;
      }
      .tasksCard {
        scroll-margin: 90px;
        padding: 13px 14px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        border-bottom: 1px solid #f0edf4;
        border-left: 3px solid transparent;
      }
      .tasksCard:last-child {
        border-bottom: 0;
      }
      .tasksCard.isFocused {
        border-left-color: #8269df;
        background: #f8f5ff;
      }
      .tasksCard.isOverdue:not(.isFocused) {
        border-left-color: #d36a55;
      }
      .tasksCardMain {
        min-width: 0;
      }
      .tasksCardBadges {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 6px;
      }
      .tasksBadge {
        width: max-content;
        padding: 3px 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 800;
      }
      .tasksBadgeDate {
        background: #f0edf7;
        color: #706a78;
      }
      .tasksBadgeDate-overdue,
      .tasksBadgeLate {
        background: #ffe8e3;
        color: #b44f3d;
      }
      .tasksBadgeDate-today {
        background: #eee9ff;
        color: #6e55cc;
      }
      .tasksBadgeUrgent {
        background: #fff0dd;
        color: #a85f18;
      }
      .tasksCard h3 {
        margin: 0;
        font-size: 13px;
        line-height: 1.35;
      }
      .tasksCard p {
        margin: 4px 0 0;
        color: #77717f;
        font-size: 10px;
        line-height: 1.4;
      }
      .tasksCardMeta {
        margin-top: 5px;
        display: flex;
        gap: 8px;
        color: #9a95a1;
        font-size: 9px;
      }
      .tasksCardActions {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .tasksCompleteButton,
      .tasksPostponeButton {
        min-height: 32px;
        padding: 0 9px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border-radius: 7px;
        font-size: 10px;
        font-weight: 750;
      }
      .tasksCompleteButton {
        border: 1px solid #cce4d5;
        background: #f2faf5;
        color: #3a8055;
      }
      .tasksPostponeButton {
        border: 1px solid #ddd8e9;
        background: white;
        color: #686270;
      }
      .tasksPostponeForm {
        grid-column: 1 / -1;
        padding: 11px;
        display: grid;
        grid-template-columns: minmax(160px, 0.55fr) minmax(220px, 1fr) auto;
        gap: 9px;
        align-items: end;
        border: 1px solid #e6e0f0;
        border-radius: 9px;
        background: #faf8ff;
      }
      .tasksPostponeForm label {
        display: grid;
        gap: 5px;
        color: #625d69;
        font-size: 9px;
        font-weight: 750;
      }
      .tasksPostponeForm input {
        min-height: 36px;
      }
      .tasksPostponeForm .primaryButton {
        min-height: 36px;
      }
      .tasksSpin {
        animation: tasksSpin 1s linear infinite;
      }
      @keyframes tasksSpin {
        to { transform: rotate(360deg); }
      }
      @media (max-width: 980px) {
        .tasksSummary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .tasksCard {
          grid-template-columns: 1fr;
        }
        .tasksCardActions {
          justify-content: flex-start;
        }
        .tasksPostponeForm {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 620px) {
        .tasksPageHeading {
          flex-direction: column;
        }
        .tasksSummary {
          grid-template-columns: 1fr 1fr;
        }
        .tasksCardActions {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .tasksCompleteButton,
        .tasksPostponeButton {
          justify-content: center;
        }
      }
    `}</style>
  );
}
