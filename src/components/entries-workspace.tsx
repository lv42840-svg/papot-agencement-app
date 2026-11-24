"use client";

import "./entries-workspace.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Tag,
  Upload,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { TaskCommercialBridge } from "@/components/task-commercial-bridge";
import {
  isAssignedOverdue,
  isQualificationAttentionDue,
  normalizePersonName,
  qualificationAttentionAt,
  type EntriesPayload,
  type EntriesTag,
  type EntryAttachment,
  type EntryRecord,
} from "@/lib/entries/domain";

type EntriesApiSnapshot = {
  payload: EntriesPayload;
  actor: { userId: string; displayName: string };
  capabilities: { canQualify: boolean; canManageTags: boolean };
  suggestedAssignees: string[];
  focusEntryId?: string;
  serverNow: string;
};

type EntriesTab = "TO_QUALIFY" | "ASSIGNED" | "DONE";
type EntryDetailTab = "INFO" | "AFFAIR" | "ATTACHMENTS" | "HISTORY";
type MutationBody = Record<string, unknown> & { action: string };
type MutationFn = (
  body: MutationBody,
  successMessage?: string,
) => Promise<EntriesApiSnapshot | null>;
type UploadFn = (entryId: string, files: File[]) => Promise<boolean>;
type NextActionDraft = {
  id: string;
  text: string;
  assigneeName: string;
  dueDate: string;
};

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  ENTRIES_LOCKED: "Les entrées sont modifiées sur un autre poste. Réessaie dans quelques secondes.",
  ENTRIES_VERSION_CONFLICT: "Les entrées ont changé sur un autre poste. La liste a été rechargée.",
  ENTRIES_REQUEST_INVALID: "Les informations envoyées sont incomplètes ou invalides.",
  QUALIFICATION_FORBIDDEN: "Tu n’as pas le droit de qualifier cette entrée.",
  TAG_ADMIN_FORBIDDEN: "Tu n’as pas le droit de gérer les tags.",
  ENTRY_NOT_FOUND: "Cette entrée n'existe plus.",
  ENTRY_NOT_TO_QUALIFY: "Cette entrée a déjà quitté la boîte À qualifier.",
  ENTRY_NOT_ASSIGNED_TO_ACTOR: "Cette action est affectée à une autre personne.",
  ENTRY_NOT_DUE_FOR_SNOOZE: "Voir plus tard devient disponible après la remontée de l'entrée.",
  SNOOZE_DATE_IN_PAST: "La date Voir plus tard ne peut pas être dans le passé.",
  POSTPONE_DATE_NOT_LATER: "La nouvelle échéance doit être postérieure à l'échéance actuelle.",
  TAG_LABEL_EXISTS: "Ce libellé de tag existe déjà.",
  ENTRY_ATTACHMENTS_TOO_MANY: "Tu peux ajouter jusqu'à 12 pièces à la fois.",
  ENTRY_ATTACHMENT_TOO_LARGE: "Une pièce jointe dépasse la limite technique de 100 Mo.",
  ENTRY_ATTACHMENT_NAME_REQUIRED: "Une pièce jointe n'a pas de nom exploitable.",
  ENTRY_ATTACHMENTS_REQUIRED: "Aucune pièce jointe n'a été sélectionnée.",
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatDateOnly(value: string | null): string {
  if (!value) return "Sans date";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day, 12),
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function entryTagLabels(entry: EntryRecord, tags: EntriesTag[]): EntriesTag[] {
  const selected = new Set(entry.tagIds);
  return tags.filter((tag) => selected.has(tag.id)).sort((a, b) => a.sortOrder - b.sortOrder);
}

function attentionText(entry: EntryRecord): string | null {
  if (entry.status !== "TO_QUALIFY") return null;
  if (entry.snoozedUntilDate) return `Reportée jusqu'au ${formatDateOnly(entry.snoozedUntilDate)}`;
  return `Remontée à partir du ${formatDateTime(qualificationAttentionAt(entry).toISOString())}`;
}

export function EntriesWorkspace() {
  const [snapshot, setSnapshot] = useState<EntriesApiSnapshot | null>(null);
  const [tab, setTab] = useState<EntriesTab>("TO_QUALIFY");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/entries", { cache: "no-store" });
      const body = (await response.json()) as EntriesApiSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "ENTRIES_LOAD_FAILED");
      setSnapshot(body);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "ENTRIES_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger les entrées pour le moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback<MutationFn>(
    async (body, successMessage) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch("/api/desktop/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = (await response.json()) as EntriesApiSnapshot & {
          error?: string;
          lockedBy?: string;
        };
        if (!response.ok) {
          const base = errorMessages[result.error ?? ""] ?? "L'action n'a pas pu être enregistrée.";
          throw new Error(result.lockedBy ? `${base} Poste en cours : ${result.lockedBy}.` : base);
        }
        setSnapshot(result);
        if (result.focusEntryId) setSelectedId(result.focusEntryId);
        if (successMessage) setNotice(successMessage);
        return result;
      } catch (mutationError) {
        const message =
          mutationError instanceof Error ? mutationError.message : "L'action a échoué.";
        setError(message);
        if (message.includes("changé sur un autre poste")) await load();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const uploadAttachments = useCallback<UploadFn>(async (entryId, files) => {
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
      const result = (await response.json()) as EntriesApiSnapshot & { error?: string };
      if (!response.ok) {
        throw new Error(
          errorMessages[result.error ?? ""] ?? "Les pièces jointes n'ont pas pu être enregistrées.",
        );
      }
      setSnapshot(result);
      setSelectedId(entryId);
      setNotice(
        `${files.length} pièce${files.length > 1 ? "s" : ""} jointe${files.length > 1 ? "s" : ""} ajoutée${files.length > 1 ? "s" : ""}.`,
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

  const payload = snapshot?.payload;
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const qualifyEntries = useMemo(
    () =>
      (payload?.entries ?? [])
        .filter((entry) => entry.status === "TO_QUALIFY")
        .sort((a, b) => {
          const attentionDelta =
            Number(isQualificationAttentionDue(b, now)) -
            Number(isQualificationAttentionDue(a, now));
          return attentionDelta || a.createdAt.localeCompare(b.createdAt);
        }),
    [payload?.entries, now],
  );
  const assignedEntries = useMemo(
    () =>
      (payload?.entries ?? [])
        .filter((entry) => entry.status === "ASSIGNED")
        .sort((a, b) => {
          const overdueDelta =
            Number(isAssignedOverdue(b, now)) - Number(isAssignedOverdue(a, now));
          return (
            overdueDelta || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
          );
        }),
    [payload?.entries, now],
  );
  const doneEntries = useMemo(
    () =>
      (payload?.entries ?? [])
        .filter((entry) => entry.status === "DONE")
        .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)),
    [payload?.entries],
  );

  const visibleEntries =
    tab === "TO_QUALIFY" ? qualifyEntries : tab === "ASSIGNED" ? assignedEntries : doneEntries;
  const selectedEntry =
    payload?.entries.find((entry) => entry.id === selectedId) ?? visibleEntries[0] ?? null;

  useEffect(() => {
    if (selectedEntry && selectedEntry.id !== selectedId) setSelectedId(selectedEntry.id);
    if (!selectedEntry && selectedId) setSelectedId(null);
  }, [selectedEntry, selectedId]);

  const unreadNotifications = useMemo(() => {
    if (!snapshot) return [];
    const actor = normalizePersonName(snapshot.actor.displayName);
    return snapshot.payload.notifications
      .filter(
        (notification) =>
          !notification.readAt && normalizePersonName(notification.recipientName) === actor,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [snapshot]);

  if (loading && !snapshot) {
    return (
      <div className="entriesLoading">
        <RefreshCw className="entriesSpin" size={20} /> Chargement des entrées…
      </div>
    );
  }

  return (
    <div className="entriesWorkspace">
      <section className="entriesPageHeading">
        <div>
          <h1>Entrées</h1>
          <p>Qualification, pièces jointes et suivi des actions.</p>
        </div>
        <div className="buttonRow">
          <Link className="primaryButton" href="/capture">
            <Camera size={16} /> Capture
          </Link>
          <button
            className="entriesRefreshButton"
            type="button"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={16} /> Actualiser
          </button>
        </div>
      </section>

      {error ? <div className="entriesMessage entriesMessageError">{error}</div> : null}
      {notice ? <div className="entriesMessage entriesMessageSuccess">{notice}</div> : null}

      {snapshot && unreadNotifications.length > 0 ? (
        <section className="entriesAlerts" aria-label="Alertes Entrées">
          <div className="entriesAlertsTitle">
            <Bell size={16} /> {unreadNotifications.length} alerte
            {unreadNotifications.length > 1 ? "s" : ""}
          </div>
          {unreadNotifications.slice(0, 4).map((notification) => (
            <div className="entriesAlertRow" key={notification.id}>
              <button
                type="button"
                className="entriesAlertText"
                onClick={() => setSelectedId(notification.entryId)}
              >
                {notification.message}
              </button>
              <button
                type="button"
                className="entriesTinyButton"
                disabled={busy}
                onClick={() =>
                  void mutate({ action: "notificationRead", notificationId: notification.id })
                }
              >
                Lu
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {snapshot ? (
        <div className="entriesMainGrid">
          <section className="entriesListPanel">
            <div className="entriesTabs" role="tablist" aria-label="État des entrées">
              <TabButton
                active={tab === "TO_QUALIFY"}
                label="À qualifier"
                count={qualifyEntries.length}
                alertCount={
                  qualifyEntries.filter((entry) => isQualificationAttentionDue(entry, now)).length
                }
                onClick={() => setTab("TO_QUALIFY")}
              />
              <TabButton
                active={tab === "ASSIGNED"}
                label="Affectées"
                count={assignedEntries.length}
                alertCount={assignedEntries.filter((entry) => isAssignedOverdue(entry, now)).length}
                onClick={() => setTab("ASSIGNED")}
              />
              <TabButton
                active={tab === "DONE"}
                label="Terminées"
                count={doneEntries.length}
                alertCount={0}
                onClick={() => setTab("DONE")}
              />
            </div>
            <div className="entriesList">
              {visibleEntries.length === 0 ? (
                <div className="entriesEmpty">
                  <CheckCircle2 size={26} />
                  <strong>Rien ici pour le moment</strong>
                  <span>La liste se remplira au fil des captures et traitements.</span>
                </div>
              ) : (
                visibleEntries.map((entry) => (
                  <EntryListRow
                    key={entry.id}
                    entry={entry}
                    tags={snapshot.payload.tags}
                    now={now}
                    selected={entry.id === selectedEntry?.id}
                    onClick={() => setSelectedId(entry.id)}
                  />
                ))
              )}
            </div>
          </section>
          <section className="entriesDetailPanel">
            {selectedEntry ? (
              <EntryDetail
                key={selectedEntry.id}
                entry={selectedEntry}
                payload={snapshot.payload}
                actorName={snapshot.actor.displayName}
                capabilities={snapshot.capabilities}
                suggestedAssignees={snapshot.suggestedAssignees}
                busy={busy}
                now={now}
                mutate={mutate}
                uploadAttachments={uploadAttachments}
                onOpenEntry={setSelectedId}
              />
            ) : (
              <div className="entriesEmpty entriesDetailEmpty">
                <Tag size={28} />
                <strong>Sélectionne une entrée</strong>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  label,
  count,
  alertCount,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  alertCount: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "isActive" : ""} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
      {alertCount > 0 ? <em>{alertCount}</em> : null}
    </button>
  );
}

function EntryListRow({
  entry,
  tags,
  now,
  selected,
  onClick,
}: {
  entry: EntryRecord;
  tags: EntriesTag[];
  now: Date;
  selected: boolean;
  onClick: () => void;
}) {
  const attention = isQualificationAttentionDue(entry, now);
  const overdue = isAssignedOverdue(entry, now);
  return (
    <button
      type="button"
      className={`entriesListRow${selected ? " isSelected" : ""}${attention || overdue ? " isAlert" : ""}`}
      onClick={onClick}
    >
      <div className="entriesListRowTop">
        <strong>{entry.rawText}</strong>
        {entry.priority === "URGENT" ? (
          <span className="entriesBadge entriesBadgeUrgent">Urgent</span>
        ) : null}
        {attention ? <span className="entriesBadge entriesBadgeAlert">À remonter</span> : null}
        {overdue ? <span className="entriesBadge entriesBadgeAlert">En retard</span> : null}
      </div>
      <div className="entriesListTags">
        {entryTagLabels(entry, tags).map((tag) => (
          <span key={tag.id}>{tag.label}</span>
        ))}
      </div>
      <div className="entriesListMeta">
        {entry.attachments.length > 0 ? (
          <span>
            <Paperclip size={12} /> {entry.attachments.length}
          </span>
        ) : null}
        {entry.status === "TO_QUALIFY" ? (
          <span>
            <Clock3 size={12} />{" "}
            {entry.snoozedUntilDate
              ? attentionText(entry)
              : `Créée ${formatDateTime(entry.createdAt)}`}
          </span>
        ) : entry.status === "ASSIGNED" ? (
          <>
            <span>
              <UserRound size={12} /> {entry.assigneeName}
            </span>
            <span>
              <Clock3 size={12} /> {formatDateOnly(entry.dueDate)}
            </span>
          </>
        ) : (
          <span>
            <Check size={12} /> Terminée{" "}
            {entry.completedAt ? formatDateTime(entry.completedAt) : ""}
          </span>
        )}
      </div>
    </button>
  );
}

function EntryDetail({
  entry,
  payload,
  actorName,
  capabilities,
  suggestedAssignees,
  busy,
  now,
  mutate,
  uploadAttachments,
  onOpenEntry,
}: {
  entry: EntryRecord;
  payload: EntriesPayload;
  actorName: string;
  capabilities: EntriesApiSnapshot["capabilities"];
  suggestedAssignees: string[];
  busy: boolean;
  now: Date;
  mutate: MutationFn;
  uploadAttachments: UploadFn;
  onOpenEntry: (entryId: string) => void;
}) {
  const [description, setDescription] = useState(entry.structuredDescription ?? entry.rawText);
  const nextAction = entry.nextAction ?? "";
  const [tagIds, setTagIds] = useState(entry.tagIds);
  const [actionDrafts, setActionDrafts] = useState<NextActionDraft[]>(() => [
    {
      id: `action-${entry.id}-1`,
      text: entry.status === "TO_QUALIFY" ? (entry.nextAction ?? "") : "",
      assigneeName: "",
      dueDate: "",
    },
  ]);
  const [result, setResult] = useState(entry.result ?? "");
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [derivedText, setDerivedText] = useState("");
  const [detailTab, setDetailTab] = useState<EntryDetailTab>("INFO");

  const canActAssigned =
    entry.status === "ASSIGNED" &&
    Boolean(entry.assigneeName) &&
    normalizePersonName(entry.assigneeName ?? "") === normalizePersonName(actorName);
  const attentionDue = isQualificationAttentionDue(entry, now);
  const overdue = isAssignedOverdue(entry, now);
  const visibleTags = payload.tags
    .filter((tag) => tag.active || tagIds.includes(tag.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const latestReassignment = [...entry.history]
    .reverse()
    .find((event) => event.type === "REASSIGNED");

  return (
    <div className="entriesDetail">
      <div className="entriesDetailHeader">
        <div className="entriesDetailBadges">
          <StatusBadge entry={entry} now={now} />
          {entry.priority === "URGENT" ? (
            <span className="entriesBadge entriesBadgeUrgent">Urgent</span>
          ) : null}
        </div>
        <h2>{entry.rawText}</h2>
        <p>
          Créée par {entry.createdByName} le {formatDateTime(entry.createdAt)}
        </p>
      </div>

      <div className="entriesDetailTabs" role="tablist" aria-label="Fiche entrée">
        <button
          type="button"
          className={detailTab === "INFO" ? "isActive" : ""}
          onClick={() => setDetailTab("INFO")}
        >
          Informations
        </button>
        <button
          type="button"
          className={detailTab === "AFFAIR" ? "isActive" : ""}
          onClick={() => setDetailTab("AFFAIR")}
        >
          Affaire
        </button>
        <button
          type="button"
          className={detailTab === "ATTACHMENTS" ? "isActive" : ""}
          onClick={() => setDetailTab("ATTACHMENTS")}
        >
          Pièces jointes
          {entry.attachments.length > 0 ? <span>{entry.attachments.length}</span> : null}
        </button>
        <button
          type="button"
          className={detailTab === "HISTORY" ? "isActive" : ""}
          onClick={() => setDetailTab("HISTORY")}
        >
          Historique
        </button>
      </div>

      {detailTab === "INFO" ? (
        <>
          <div className="entriesRawText">
            <span>Texte d'origine</span>
            <p>{entry.rawText}</p>
          </div>

          {entry.parentEntryId ? (
            <button
              type="button"
              className="entriesLinkedButton"
              onClick={() => onOpenEntry(entry.parentEntryId!)}
            >
              Entrée d'origine
            </button>
          ) : null}
          {entry.derivedEntryIds.length > 0 ? (
            <div className="entriesLinkedGroup">
              <span>
                Entrée{entry.derivedEntryIds.length > 1 ? "s" : ""} dérivée
                {entry.derivedEntryIds.length > 1 ? "s" : ""}
              </span>
              {entry.derivedEntryIds.map((id, index) => (
                <button type="button" key={id} onClick={() => onOpenEntry(id)}>
                  Ouvrir #{index + 1}
                </button>
              ))}
            </div>
          ) : null}

          {entry.status === "TO_QUALIFY" ? (
            <>
              <section className="entriesDetailSection">
                <div className="entriesSectionTitle">
                  <Tag size={15} /> Qualification
                </div>
                {capabilities.canQualify ? (
                  <>
                    <div className="entriesDetailTags">
                      {visibleTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={`entriesTagChoice${tagIds.includes(tag.id) ? " isSelected" : ""}`}
                          onClick={() =>
                            setTagIds((current) =>
                              current.includes(tag.id)
                                ? current.filter((id) => id !== tag.id)
                                : [...current, tag.id],
                            )
                          }
                        >
                          {tag.label}
                          {!tag.active ? " (désactivé)" : ""}
                        </button>
                      ))}
                    </div>
                    <label className="entriesField">
                      <span>C'est quoi ?</span>
                      <textarea
                        rows={3}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </label>

                    <button
                      type="button"
                      className="secondaryButton entriesSaveDraft"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          {
                            action: "qualifyDraft",
                            entryId: entry.id,
                            description,
                            nextAction: "",
                            tagIds,
                          },
                          "Qualification enregistrée. L'entrée reste dans À qualifier.",
                        )
                      }
                    >
                      <Save size={15} /> Enregistrer sans sortir
                    </button>
                  </>
                ) : (
                  <p className="entriesReadOnlyNote">
                    Tu n’as pas le droit de qualifier cette entrée.
                  </p>
                )}
              </section>

              {capabilities.canQualify ? (
                <section className="entriesDetailSection entriesActionSection">
                  <div className="entriesSectionTitle">
                    <UserRound size={15} /> Actions suivantes
                  </div>
                  <div className="entriesNextActions">
                    {actionDrafts.map((actionDraft, index) => (
                      <div className="entriesNextActionCard" key={actionDraft.id}>
                        <div className="entriesNextActionHeader">
                          <strong>Action suivante {index + 1}</strong>
                          {actionDrafts.length > 1 ? (
                            <button
                              type="button"
                              className="entriesIconButton"
                              title="Supprimer cette action"
                              onClick={() =>
                                setActionDrafts((current) =>
                                  current.filter((item) => item.id !== actionDraft.id),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : null}
                        </div>
                        <label className="entriesField">
                          <span>Action suivante</span>
                          <textarea
                            rows={2}
                            value={actionDraft.text}
                            onChange={(event) =>
                              setActionDrafts((current) =>
                                current.map((item) =>
                                  item.id === actionDraft.id
                                    ? { ...item, text: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Ex. Préparer le devis, rappeler le client..."
                          />
                        </label>
                        <div className="entriesTwoFields">
                          <label className="entriesField">
                            <span>Responsable</span>
                            <input
                              list={`entry-assignees-${entry.id}`}
                              value={actionDraft.assigneeName}
                              onChange={(event) =>
                                setActionDrafts((current) =>
                                  current.map((item) =>
                                    item.id === actionDraft.id
                                      ? { ...item, assigneeName: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder="Choisir un utilisateur…"
                            />
                          </label>
                          <label className="entriesField">
                            <span>Date limite</span>
                            <input
                              type="date"
                              value={actionDraft.dueDate}
                              onChange={(event) =>
                                setActionDrafts((current) =>
                                  current.map((item) =>
                                    item.id === actionDraft.id
                                      ? { ...item, dueDate: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <datalist id={`entry-assignees-${entry.id}`}>
                      {suggestedAssignees.map((name) => (
                        <option value={name} key={name} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={busy || actionDrafts.length >= 20}
                      onClick={() =>
                        setActionDrafts((current) => [
                          ...current,
                          {
                            id: crypto.randomUUID(),
                            text: "",
                            assigneeName: "",
                            dueDate: "",
                          },
                        ])
                      }
                    >
                      <Plus size={15} /> Ajouter une action
                    </button>
                    <button
                      type="button"
                      className="primaryButton"
                      disabled={
                        busy ||
                        !description.trim() ||
                        actionDrafts.length === 0 ||
                        actionDrafts.some(
                          (item) => !item.text.trim() || !item.assigneeName.trim() || !item.dueDate,
                        )
                      }
                      onClick={() =>
                        void mutate(
                          {
                            action: "qualifyActions",
                            entryId: entry.id,
                            description,
                            tagIds,
                            actions: actionDrafts.map((item) => ({
                              text: item.text,
                              assigneeName: item.assigneeName,
                              dueDate: item.dueDate,
                            })),
                          },
                          `Note validée et ${actionDrafts.length} action${actionDrafts.length > 1 ? "s" : ""} créée${actionDrafts.length > 1 ? "s" : ""}.`,
                        )
                      }
                    >
                      Valider la note et créer les actions
                    </button>
                  </div>
                  <div className="entriesDivider" />
                  <label className="entriesField">
                    <span>Résultat facultatif</span>
                    <textarea
                      rows={2}
                      value={result}
                      onChange={(event) => setResult(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        { action: "qualifyDone", entryId: entry.id, result, tagIds },
                        "Entrée traitée et terminée.",
                      )
                    }
                  >
                    <Check size={15} /> Traité / terminé
                  </button>
                </section>
              ) : null}

              {capabilities.canQualify && attentionDue ? (
                <section className="entriesDetailSection entriesWarningSection">
                  <div className="entriesSectionTitle">
                    <AlertTriangle size={15} /> Remontée obligatoire
                  </div>
                  <p>
                    Cette entrée a atteint son seuil de traitement. Elle doit être traitée ou
                    reportée explicitement.
                  </p>
                  <div className="entriesTwoFields">
                    <label className="entriesField">
                      <span>Voir plus tard, au plus tard le</span>
                      <input
                        type="date"
                        value={snoozeDate}
                        onChange={(event) => setSnoozeDate(event.target.value)}
                      />
                    </label>
                    <label className="entriesField">
                      <span>Motif obligatoire</span>
                      <input
                        value={snoozeReason}
                        onChange={(event) => setSnoozeReason(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !snoozeDate || !snoozeReason.trim()}
                    onClick={() =>
                      void mutate(
                        {
                          action: "snooze",
                          entryId: entry.id,
                          untilDate: snoozeDate,
                          reason: snoozeReason,
                        },
                        "Entrée reportée avec motif.",
                      )
                    }
                  >
                    <Clock3 size={15} /> Voir plus tard
                  </button>
                </section>
              ) : null}

              {capabilities.canQualify ? (
                <details className="entriesDerivedBox">
                  <summary>Créer une deuxième entrée liée</summary>
                  <p>
                    À utiliser uniquement si la capture contient réellement deux sujets distincts.
                  </p>
                  <textarea
                    rows={2}
                    value={derivedText}
                    onChange={(event) => setDerivedText(event.target.value)}
                  />
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !derivedText.trim()}
                    onClick={() =>
                      void mutate(
                        { action: "derive", entryId: entry.id, rawText: derivedText },
                        "Entrée liée créée.",
                      )
                    }
                  >
                    Créer l'entrée liée
                  </button>
                </details>
              ) : null}
            </>
          ) : null}

          {entry.status === "ASSIGNED" ? (
            <>
              <section className={`entriesAssignmentSummary${overdue ? " isOverdue" : ""}`}>
                <div>
                  <span>Responsable</span>
                  <strong>{entry.assigneeName}</strong>
                </div>
                <div>
                  <span>Échéance</span>
                  <strong>{formatDateOnly(entry.dueDate)}</strong>
                </div>
                {overdue ? (
                  <div className="entriesOverdueLabel">
                    <AlertTriangle size={14} /> En retard
                  </div>
                ) : null}
              </section>
              {latestReassignment ? (
                <section className="entriesDetailSection entriesCompactSection">
                  <strong>Dernière réaffectation</strong>
                  <p>{latestReassignment.summary}</p>
                  <span>
                    {latestReassignment.actorName} · {formatDateTime(latestReassignment.at)}
                  </span>
                </section>
              ) : null}
              {entry.structuredDescription ? (
                <section className="entriesDetailSection entriesCompactSection">
                  <strong>C'est quoi ?</strong>
                  <p>{entry.structuredDescription}</p>
                  <strong>J'en fais quoi ?</strong>
                  <p>{entry.nextAction || "Non renseigné"}</p>
                </section>
              ) : null}
              {canActAssigned ? (
                <section className="entriesDetailSection entriesActionSection">
                  <div className="entriesSectionTitle">
                    <Clock3 size={15} /> Mes actions
                  </div>
                  <div className="entriesNextActions">
                    {actionDrafts.map((actionDraft, index) => (
                      <div className="entriesNextActionCard" key={actionDraft.id}>
                        <div className="entriesNextActionHeader">
                          <strong>Nouvelle action {index + 1}</strong>
                          {actionDrafts.length > 1 ? (
                            <button
                              type="button"
                              className="entriesIconButton"
                              title="Supprimer cette action"
                              onClick={() =>
                                setActionDrafts((current) =>
                                  current.filter((item) => item.id !== actionDraft.id),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : null}
                        </div>
                        <label className="entriesField">
                          <span>Action</span>
                          <textarea
                            rows={2}
                            value={actionDraft.text}
                            onChange={(event) =>
                              setActionDrafts((current) =>
                                current.map((item) =>
                                  item.id === actionDraft.id
                                    ? { ...item, text: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder="Ex. Rappeler le client, préparer une commande..."
                          />
                        </label>
                        <div className="entriesTwoFields">
                          <label className="entriesField">
                            <span>Responsable</span>
                            <input
                              list={`entry-assigned-actions-${entry.id}`}
                              value={actionDraft.assigneeName}
                              onChange={(event) =>
                                setActionDrafts((current) =>
                                  current.map((item) =>
                                    item.id === actionDraft.id
                                      ? { ...item, assigneeName: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder="Choisir un utilisateur…"
                            />
                          </label>
                          <label className="entriesField">
                            <span>Date limite</span>
                            <input
                              type="date"
                              value={actionDraft.dueDate}
                              onChange={(event) =>
                                setActionDrafts((current) =>
                                  current.map((item) =>
                                    item.id === actionDraft.id
                                      ? { ...item, dueDate: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <datalist id={`entry-assigned-actions-${entry.id}`}>
                      {suggestedAssignees.map((name) => (
                        <option value={name} key={name} />
                      ))}
                    </datalist>
                    <div className="buttonRow">
                      <button
                        type="button"
                        className="secondaryButton"
                        disabled={busy || actionDrafts.length >= 20}
                        onClick={() =>
                          setActionDrafts((current) => [
                            ...current,
                            {
                              id: crypto.randomUUID(),
                              text: "",
                              assigneeName: "",
                              dueDate: "",
                            },
                          ])
                        }
                      >
                        <Plus size={15} /> Ajouter une action
                      </button>
                      <button
                        type="button"
                        className="secondaryButton"
                        disabled={
                          busy ||
                          actionDrafts.length === 0 ||
                          actionDrafts.some(
                            (item) =>
                              !item.text.trim() || !item.assigneeName.trim() || !item.dueDate,
                          )
                        }
                        onClick={() =>
                          void mutate(
                            {
                              action: "assignedActions",
                              entryId: entry.id,
                              actions: actionDrafts.map((item) => ({
                                text: item.text,
                                assigneeName: item.assigneeName,
                                dueDate: item.dueDate,
                              })),
                            },
                            `${actionDrafts.length} action${actionDrafts.length > 1 ? "s" : ""} créée${actionDrafts.length > 1 ? "s" : ""}. La tâche reste ouverte.`,
                          ).then((saved) => {
                            if (saved) {
                              setActionDrafts([
                                {
                                  id: crypto.randomUUID(),
                                  text: "",
                                  assigneeName: "",
                                  dueDate: "",
                                },
                              ]);
                            }
                          })
                        }
                      >
                        Enregistrer les actions
                      </button>
                    </div>
                  </div>
                  <div className="entriesDivider" />
                  <label className="entriesField">
                    <span>Résultat facultatif</span>
                    <textarea
                      rows={2}
                      value={result}
                      onChange={(event) => setResult(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        { action: "complete", entryId: entry.id, result },
                        "Action terminée.",
                      )
                    }
                  >
                    <Check size={15} /> Terminé
                  </button>
                  <div className="entriesDivider" />
                  <div className="entriesTwoFields">
                    <label className="entriesField">
                      <span>Nouvelle échéance</span>
                      <input
                        type="date"
                        value={postponeDate}
                        onChange={(event) => setPostponeDate(event.target.value)}
                      />
                    </label>
                    <label className="entriesField">
                      <span>Motif obligatoire</span>
                      <input
                        value={postponeReason}
                        onChange={(event) => setPostponeReason(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !postponeDate || !postponeReason.trim()}
                    onClick={() =>
                      void mutate(
                        {
                          action: "postpone",
                          entryId: entry.id,
                          dueDate: postponeDate,
                          reason: postponeReason,
                        },
                        "Échéance reportée. Les responsables sont informés dans PAPOT.",
                      )
                    }
                  >
                    Reporter l'échéance
                  </button>
                  <div className="entriesDivider" />
                  <div className="entriesTwoFields">
                    <label className="entriesField">
                      <span>Nouveau responsable</span>
                      <input
                        list={`reassign-${entry.id}`}
                        value={newAssignee}
                        onChange={(event) => setNewAssignee(event.target.value)}
                      />
                      <datalist id={`reassign-${entry.id}`}>
                        {suggestedAssignees.map((name) => (
                          <option value={name} key={name} />
                        ))}
                      </datalist>
                    </label>
                    <label className="entriesField">
                      <span>Motif obligatoire</span>
                      <input
                        value={reassignReason}
                        onChange={(event) => setReassignReason(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !newAssignee.trim() || !reassignReason.trim()}
                    onClick={() =>
                      void mutate(
                        {
                          action: "reassign",
                          entryId: entry.id,
                          assigneeName: newAssignee,
                          reason: reassignReason,
                        },
                        "Action réaffectée. L'échéance est restée inchangée.",
                      )
                    }
                  >
                    Réaffecter
                  </button>
                </section>
              ) : (
                <p className="entriesReadOnlyNote">
                  Seule la personne actuellement affectée peut terminer, reporter ou réaffecter
                  cette action.
                </p>
              )}
            </>
          ) : null}

          {entry.status === "DONE" ? (
            <section className="entriesDoneSummary">
              <CheckCircle2 size={22} />
              <div>
                <strong>Terminée</strong>
                <span>{entry.completedAt ? formatDateTime(entry.completedAt) : ""}</span>
                {entry.result ? <p>{entry.result}</p> : null}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {detailTab === "AFFAIR" ? (
        <TaskCommercialBridge task={entry} description={description} nextAction={nextAction} />
      ) : null}

      {detailTab === "ATTACHMENTS" ? (
        <EntryAttachments entry={entry} busy={busy} uploadAttachments={uploadAttachments} />
      ) : null}

      {detailTab === "HISTORY" ? (
        <section className="entriesHistory">
          <h3>Historique</h3>
          {[...entry.history].reverse().map((event) => (
            <div className="entriesHistoryRow" key={event.id}>
              <span className="entriesHistoryDot" />
              <div>
                <strong>{event.summary}</strong>
                <span>
                  {event.actorName} · {formatDateTime(event.at)}
                </span>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function EntryAttachments({
  entry,
  busy,
  uploadAttachments,
}: {
  entry: EntryRecord;
  busy: boolean;
  uploadAttachments: UploadFn;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  return (
    <section className="entriesDetailSection entriesAttachmentsSection">
      <div className="entriesSectionTitle">
        <Paperclip size={15} /> Pièces jointes{" "}
        <span className="entriesAttachmentCount">{entry.attachments.length}</span>
      </div>
      {entry.attachments.length === 0 ? (
        <p className="entriesAttachmentEmpty">
          Aucune pièce jointe. Les originaux sont conservés dans le stockage PAPOT.
        </p>
      ) : (
        <div className="entriesAttachmentList">
          {entry.attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              entryId={entry.id}
              attachment={attachment}
              preview={previewId === attachment.id}
              onPreview={() =>
                setPreviewId((current) => (current === attachment.id ? null : attachment.id))
              }
            />
          ))}
        </div>
      )}
      <div className="entriesAttachmentAdd">
        <FilePicker
          label="Ajouter des pièces"
          files={pending}
          onChange={setPending}
          disabled={busy}
        />
        {pending.length > 0 ? (
          <button
            type="button"
            className="primaryButton"
            disabled={busy}
            onClick={() =>
              void uploadAttachments(entry.id, pending).then((ok) => {
                if (ok) setPending([]);
              })
            }
          >
            <Upload size={15} /> Envoyer {pending.length}
          </button>
        ) : null}
      </div>
      {pending.length > 0 ? <PendingFiles files={pending} onChange={setPending} compact /> : null}
    </section>
  );
}

function AttachmentRow({
  entryId,
  attachment,
  preview,
  onPreview,
}: {
  entryId: string;
  attachment: EntryAttachment;
  preview: boolean;
  onPreview: () => void;
}) {
  const url = `/api/desktop/entries/${entryId}/attachments/${attachment.id}`;
  const isImage = attachment.contentType.startsWith("image/");
  const isPdf = attachment.contentType === "application/pdf";
  return (
    <div className="entriesAttachmentRow">
      {isImage ? (
        <button
          type="button"
          className="entriesAttachmentThumbnail"
          onClick={onPreview}
          title="Voir l’image en grand"
          aria-label={`Voir ${attachment.fileName} en grand`}
        >
          <img src={url} alt="" />
        </button>
      ) : (
        <div className="entriesAttachmentIcon">
          <FileText size={18} />
        </div>
      )}
      <div className="entriesAttachmentMeta">
        <strong title={attachment.fileName}>{attachment.fileName}</strong>
        <span>
          {formatBytes(attachment.sizeBytes)} · ajouté par {attachment.uploadedByName} le{" "}
          {formatDateTime(attachment.uploadedAt)}
        </span>
      </div>
      {isPdf ? (
        <button type="button" className="entriesIconButton" title="Aperçu PDF" onClick={onPreview}>
          <Eye size={16} />
        </button>
      ) : isImage ? (
        <button
          type="button"
          className="entriesIconButton"
          title="Voir en grand"
          onClick={onPreview}
        >
          <Eye size={16} />
        </button>
      ) : null}
      <a
        className="entriesIconButton"
        title="Télécharger"
        href={`${url}?download=1`}
        download={attachment.fileName}
      >
        <Download size={16} />
      </a>
      {preview && isImage ? (
        <div
          className="entriesImageLightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Aperçu de ${attachment.fileName}`}
          onClick={onPreview}
        >
          <div className="entriesImageLightboxContent" onClick={(event) => event.stopPropagation()}>
            <div className="entriesImageLightboxHeader">
              <strong>{attachment.fileName}</strong>
              <button
                type="button"
                className="entriesIconButton"
                onClick={onPreview}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>
            <img src={url} alt={attachment.fileName} />
          </div>
        </div>
      ) : preview && isPdf ? (
        <div className="entriesAttachmentPreview">
          <iframe title={attachment.fileName} src={url} />
        </div>
      ) : null}
    </div>
  );
}

function FilePicker({
  label,
  files,
  onChange,
  disabled,
}: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        className="entriesFileInput"
        type="file"
        multiple
        disabled={disabled}
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          onChange([...files, ...selected].slice(0, 12));
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        className="entriesFileButton"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <Paperclip size={14} /> {label}
        {files.length > 0 ? ` (${files.length})` : ""}
      </button>
    </>
  );
}

function PendingFiles({
  files,
  onChange,
  compact = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  compact?: boolean;
}) {
  return (
    <div className={`entriesPendingFiles${compact ? " isCompact" : ""}`}>
      {files.map((file, index) => (
        <PendingFile
          key={`${file.name}-${file.lastModified}-${index}`}
          file={file}
          onRemove={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
        />
      ))}
    </div>
  );
}

function PendingFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = file.type.startsWith("image/");
  useEffect(() => {
    if (!image) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, image]);
  return (
    <div className="entriesPendingFile">
      {image && url ? (
        <img src={url} alt="" />
      ) : (
        <span className="entriesPendingFileIcon">
          <FileText size={16} />
        </span>
      )}
      <div>
        <strong>{file.name}</strong>
        <span>{formatBytes(file.size)}</span>
      </div>
      <button type="button" title="Retirer" onClick={onRemove}>
        <X size={15} />
      </button>
    </div>
  );
}

function StatusBadge({ entry, now }: { entry: EntryRecord; now: Date }) {
  if (entry.status === "DONE")
    return <span className="entriesBadge entriesBadgeDone">Terminée</span>;
  if (entry.status === "ASSIGNED")
    return isAssignedOverdue(entry, now) ? (
      <span className="entriesBadge entriesBadgeAlert">En retard</span>
    ) : (
      <span className="entriesBadge entriesBadgeAssigned">Affectée</span>
    );
  return isQualificationAttentionDue(entry, now) ? (
    <span className="entriesBadge entriesBadgeAlert">À remonter</span>
  ) : (
    <span className="entriesBadge entriesBadgeQualify">À qualifier</span>
  );
}
