"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Tag,
  Upload,
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

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  ENTRIES_LOCKED: "Les entrées sont modifiées sur un autre poste. Réessaie dans quelques secondes.",
  ENTRIES_VERSION_CONFLICT: "Les entrées ont changé sur un autre poste. La liste a été rechargée.",
  ENTRIES_REQUEST_INVALID: "Les informations envoyées sont incomplètes ou invalides.",
  QUALIFICATION_FORBIDDEN: "La qualification est réservée à Nadia et Lucien.",
  TAG_ADMIN_FORBIDDEN: "La gestion des tags est réservée à Lucien.",
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
  const [captureText, setCaptureText] = useState("");
  const [capturePriority, setCapturePriority] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [captureTagIds, setCaptureTagIds] = useState<string[]>([]);
  const [captureFiles, setCaptureFiles] = useState<File[]>([]);

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

  async function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captureText.trim()) return;
    const created = await mutate({
      action: "create",
      rawText: captureText,
      priority: capturePriority,
      tagIds: captureTagIds,
    });
    if (!created?.focusEntryId) return;

    const entryId = created.focusEntryId;
    const files = captureFiles;
    setCaptureText("");
    setCapturePriority("NORMAL");
    setCaptureTagIds([]);
    setCaptureFiles([]);
    setTab("TO_QUALIFY");

    if (files.length > 0) {
      const uploaded = await uploadAttachments(entryId, files);
      if (!uploaded) {
        setError(
          "L'entrée a bien été créée, mais ses pièces jointes n'ont pas toutes été ajoutées. Tu peux les remettre depuis le détail de l'entrée.",
        );
      }
    } else {
      setNotice("Entrée ajoutée à À qualifier.");
    }
  }

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
          <p>Capture rapide, qualification, pièces jointes et suivi des actions.</p>
        </div>
        <button
          className="entriesRefreshButton"
          type="button"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw size={16} /> Actualiser
        </button>
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
        <form className="entriesQuickCapture" onSubmit={submitCapture}>
          <div className="entriesQuickCaptureMain">
            <div className="entriesCaptureIcon">
              <Plus size={19} />
            </div>
            <label className="entriesCaptureField">
              <span>Nouvelle entrée</span>
              <textarea
                value={captureText}
                onChange={(event) => setCaptureText(event.target.value)}
                placeholder="Client, lieu, besoin ou note rapide"
                rows={2}
                disabled={busy}
                required
              />
            </label>
            <button
              className="primaryButton entriesAddButton"
              type="submit"
              disabled={busy || !captureText.trim()}
            >
              {busy ? "Enregistrement…" : "Ajouter"}
            </button>
          </div>
          <div className="entriesQuickOptions">
            <button
              type="button"
              className={`entriesUrgentToggle${capturePriority === "URGENT" ? " isActive" : ""}`}
              onClick={() =>
                setCapturePriority((current) => (current === "URGENT" ? "NORMAL" : "URGENT"))
              }
            >
              <AlertTriangle size={14} /> Urgent
            </button>
            {snapshot.payload.tags
              .filter((tag) => tag.active)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`entriesTagChoice${captureTagIds.includes(tag.id) ? " isSelected" : ""}`}
                  onClick={() =>
                    setCaptureTagIds((current) =>
                      current.includes(tag.id)
                        ? current.filter((tagId) => tagId !== tag.id)
                        : [...current, tag.id],
                    )
                  }
                >
                  {tag.label}
                </button>
              ))}
            <FilePicker
              label="Ajouter des pièces"
              files={captureFiles}
              onChange={setCaptureFiles}
              disabled={busy}
            />
          </div>
          {captureFiles.length > 0 ? (
            <PendingFiles files={captureFiles} onChange={setCaptureFiles} />
          ) : null}
          <div className="entriesCaptureHint">
            Seul le texte est obligatoire. Tags, urgence, photos et documents restent facultatifs.
          </div>
        </form>
      ) : null}

      {snapshot?.capabilities.canManageTags ? (
        <TagAdmin tags={snapshot.payload.tags} busy={busy} mutate={mutate} />
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
      <EntriesStyles />
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
  const [nextAction, setNextAction] = useState(entry.nextAction ?? "");
  const [tagIds, setTagIds] = useState(entry.tagIds);
  const [assigneeName, setAssigneeName] = useState(entry.assigneeName ?? "");
  const [dueDate, setDueDate] = useState(entry.dueDate ?? "");
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
                <label className="entriesField">
                  <span>J'en fais quoi ?</span>
                  <textarea
                    rows={2}
                    value={nextAction}
                    onChange={(event) => setNextAction(event.target.value)}
                    placeholder="Action attendue ou prochaine étape"
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
                        nextAction,
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
              <p className="entriesReadOnlyNote">Qualification réservée à Nadia et Lucien.</p>
            )}
          </section>

          {capabilities.canQualify ? (
            <section className="entriesDetailSection entriesActionSection">
              <div className="entriesSectionTitle">
                <UserRound size={15} /> Prendre en charge
              </div>
              <div className="entriesTwoFields">
                <label className="entriesField">
                  <span>Responsable</span>
                  <input
                    list={`entry-assignees-${entry.id}`}
                    value={assigneeName}
                    onChange={(event) => setAssigneeName(event.target.value)}
                    placeholder="Nadia, Lucien…"
                  />
                  <datalist id={`entry-assignees-${entry.id}`}>
                    {suggestedAssignees.map((name) => (
                      <option value={name} key={name} />
                    ))}
                  </datalist>
                </label>
                <label className="entriesField">
                  <span>Date limite</span>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="primaryButton"
                disabled={
                  busy ||
                  !description.trim() ||
                  !nextAction.trim() ||
                  !assigneeName.trim() ||
                  !dueDate
                }
                onClick={() =>
                  void mutate(
                    {
                      action: "qualifyAssign",
                      entryId: entry.id,
                      description,
                      nextAction,
                      assigneeName,
                      dueDate,
                      tagIds,
                    },
                    "Entrée qualifiée et affectée.",
                  )
                }
              >
                Affecter avec échéance
              </button>
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
                Cette entrée a atteint son seuil de traitement. Elle doit être traitée ou reportée
                explicitement.
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
              <p>À utiliser uniquement si la capture contient réellement deux sujets distincts.</p>
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
                  void mutate({ action: "complete", entryId: entry.id, result }, "Action terminée.")
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
                    "Échéance reportée. Nadia et Lucien sont informés dans PAPOT.",
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
              Seule la personne actuellement affectée peut terminer, reporter ou réaffecter cette
              action.
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
          Aucune pièce jointe. Les originaux ajoutés ici sont conservés dans Nextcloud.
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
        <button type="button" className="entriesIconButton" title="Voir en grand" onClick={onPreview}>
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
              <button type="button" className="entriesIconButton" onClick={onPreview} aria-label="Fermer">
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

function TagAdmin({
  tags,
  busy,
  mutate,
}: {
  tags: EntriesTag[];
  busy: boolean;
  mutate: MutationFn;
}) {
  const [newLabel, setNewLabel] = useState("");
  const ordered = [...tags].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <details className="entriesTagAdmin">
      <summary>
        <Tag size={14} /> Gérer les tags
      </summary>
      <div className="entriesTagAdminBody">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!newLabel.trim()) return;
            void mutate({ action: "tagAdd", label: newLabel }, "Tag ajouté.").then((ok) => {
              if (ok) setNewLabel("");
            });
          }}
        >
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="Nouveau tag"
          />
          <button type="submit" className="secondaryButton" disabled={busy || !newLabel.trim()}>
            <Plus size={14} /> Ajouter
          </button>
        </form>
        <div className="entriesTagAdminList">
          {ordered.map((tag, index) => (
            <TagAdminRow
              key={tag.id}
              tag={tag}
              first={index === 0}
              last={index === ordered.length - 1}
              busy={busy}
              mutate={mutate}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function TagAdminRow({
  tag,
  first,
  last,
  busy,
  mutate,
}: {
  tag: EntriesTag;
  first: boolean;
  last: boolean;
  busy: boolean;
  mutate: MutationFn;
}) {
  const [label, setLabel] = useState(tag.label);
  const [active, setActive] = useState(tag.active);
  useEffect(() => {
    setLabel(tag.label);
    setActive(tag.active);
  }, [tag.label, tag.active]);
  return (
    <div className="entriesTagAdminRow">
      <input value={label} onChange={(event) => setLabel(event.target.value)} />
      <label>
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />{" "}
        Actif
      </label>
      <button
        type="button"
        title="Monter"
        disabled={busy || first}
        onClick={() => void mutate({ action: "tagMove", tagId: tag.id, direction: "up" })}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        title="Descendre"
        disabled={busy || last}
        onClick={() => void mutate({ action: "tagMove", tagId: tag.id, direction: "down" })}
      >
        <ChevronDown size={15} />
      </button>
      <button
        type="button"
        className="entriesTinyButton"
        disabled={busy || !label.trim()}
        onClick={() =>
          void mutate({ action: "tagUpdate", tagId: tag.id, label, active }, "Tag enregistré.")
        }
      >
        Enregistrer
      </button>
    </div>
  );
}

function EntriesStyles() {
  return (
    <style jsx global>{`
      .entriesWorkspace {
        display: grid;
        gap: 16px;
        width: 100%;
      }
      .entriesPageHeading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
      }
      .entriesPageHeading h1 {
        margin: 0 0 4px;
        font-size: 27px;
      }
      .entriesPageHeading p {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
      }
      .entriesRefreshButton,
      .entriesFileButton {
        min-height: 36px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: 1px solid #ddd9e8;
        border-radius: 8px;
        background: #fff;
        color: #555261;
      }
      .entriesMessage {
        padding: 10px 13px;
        border-radius: 9px;
        font-size: 12px;
      }
      .entriesMessageError {
        border: 1px solid #f0c5c5;
        background: #fff2f2;
        color: #a73b3b;
      }
      .entriesMessageSuccess {
        border: 1px solid #bfe4cc;
        background: #effaf3;
        color: #27774a;
      }
      .entriesAlerts {
        display: grid;
        gap: 7px;
        padding: 12px 14px;
        border: 1px solid #ead8a8;
        border-radius: 10px;
        background: #fffbef;
      }
      .entriesAlertsTitle {
        display: flex;
        align-items: center;
        gap: 7px;
        color: #8e661b;
        font-size: 12px;
        font-weight: 800;
      }
      .entriesAlertRow {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .entriesAlertText {
        flex: 1;
        padding: 0;
        border: 0;
        background: transparent;
        color: #5c4a26;
        text-align: left;
        font-size: 12px;
      }
      .entriesTinyButton {
        min-height: 29px;
        padding: 0 9px;
        border: 1px solid #ddd9e8;
        border-radius: 7px;
        background: #fff;
        color: #5c5867;
        font-size: 11px;
        font-weight: 700;
      }
      .entriesQuickCapture {
        padding: 15px;
        border: 1px solid #e5e0ef;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 5px 18px rgb(49 37 89 / 0.035);
      }
      .entriesQuickCaptureMain {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .entriesCaptureIcon {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #eee9ff;
        color: #7658da;
      }
      .entriesCaptureField {
        display: grid;
        gap: 5px;
      }
      .entriesCaptureField > span,
      .entriesField > span {
        color: #5b5763;
        font-size: 10px;
        font-weight: 750;
      }
      .entriesQuickCapture textarea,
      .entriesField textarea,
      .entriesDerivedBox textarea {
        width: 100%;
        resize: vertical;
        padding: 10px 12px;
        border: 1px solid #dcd8e4;
        border-radius: 8px;
        background: #fff;
        color: var(--text);
        outline: none;
        font: inherit;
      }
      .entriesQuickCapture textarea:focus,
      .entriesField textarea:focus,
      .entriesDerivedBox textarea:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
      }
      .entriesAddButton {
        min-width: 110px;
      }
      .entriesQuickOptions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        padding: 10px 0 0 48px;
      }
      .entriesUrgentToggle,
      .entriesTagChoice {
        min-height: 30px;
        padding: 0 9px;
        border: 1px solid #ddd9e5;
        border-radius: 7px;
        background: #fff;
        color: #5e5a68;
        font-size: 11px;
      }
      .entriesUrgentToggle {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .entriesUrgentToggle.isActive {
        border-color: #e5a66d;
        background: #fff2df;
        color: #a55d19;
      }
      .entriesTagChoice.isSelected {
        border-color: #9d8be7;
        background: #f1edff;
        color: #6551c7;
        font-weight: 750;
      }
      .entriesFileButton {
        min-height: 30px;
        font-size: 11px;
      }
      .entriesFileInput {
        display: none;
      }
      .entriesCaptureHint {
        padding: 8px 0 0 48px;
        color: #8b8794;
        font-size: 10px;
      }
      .entriesPendingFiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 8px;
        padding: 10px 0 0 48px;
      }
      .entriesPendingFiles.isCompact {
        padding: 0;
        grid-template-columns: 1fr;
      }
      .entriesPendingFile {
        min-width: 0;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) 28px;
        gap: 8px;
        align-items: center;
        padding: 7px;
        border: 1px solid #e6e1ed;
        border-radius: 8px;
        background: #faf9fd;
      }
      .entriesPendingFile img,
      .entriesPendingFileIcon {
        width: 42px;
        height: 42px;
        object-fit: cover;
        border-radius: 6px;
        display: grid;
        place-items: center;
        background: #eeeaf5;
        color: #756d82;
      }
      .entriesPendingFile > div {
        display: grid;
        min-width: 0;
      }
      .entriesPendingFile strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
      }
      .entriesPendingFile span {
        color: #918c98;
        font-size: 9px;
      }
      .entriesPendingFile button {
        width: 28px;
        height: 28px;
        padding: 0;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #8b8592;
      }
      .entriesPendingFile button:hover {
        background: #f0ecf5;
        color: #b44d3a;
      }
      .entriesTagAdmin {
        border: 1px solid #ebe7f2;
        border-radius: 10px;
        background: #fbfaff;
      }
      .entriesTagAdmin > summary {
        padding: 10px 13px;
        display: flex;
        align-items: center;
        gap: 7px;
        cursor: pointer;
        color: #625d70;
        font-size: 11px;
        font-weight: 750;
      }
      .entriesTagAdminBody {
        padding: 0 13px 13px;
      }
      .entriesTagAdminBody > form {
        display: flex;
        gap: 8px;
        margin-bottom: 9px;
      }
      .entriesTagAdminBody > form input {
        max-width: 280px;
      }
      .entriesTagAdminList {
        display: grid;
        gap: 6px;
      }
      .entriesTagAdminRow {
        display: grid;
        grid-template-columns: minmax(150px, 1fr) auto 30px 30px auto;
        gap: 6px;
        align-items: center;
      }
      .entriesTagAdminRow label {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
      }
      .entriesTagAdminRow label input {
        width: auto;
        min-height: auto;
      }
      .entriesTagAdminRow > button:not(.entriesTinyButton) {
        width: 30px;
        height: 30px;
        padding: 0;
        display: grid;
        place-items: center;
        border: 1px solid #ddd9e8;
        border-radius: 7px;
        background: #fff;
      }
      .entriesMainGrid {
        min-height: 590px;
        display: grid;
        grid-template-columns: minmax(340px, 0.78fr) minmax(500px, 1.42fr);
        gap: 14px;
      }
      .entriesListPanel,
      .entriesDetailPanel {
        min-width: 0;
        border: 1px solid #e8e4f0;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 5px 18px rgb(49 37 89 / 0.035);
        overflow: hidden;
      }
      .entriesTabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-bottom: 1px solid #ece8f2;
        background: #fbfaff;
      }
      .entriesTabs button {
        min-height: 48px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 6px;
        border: 0;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: #74707e;
        font-size: 11px;
      }
      .entriesTabs button.isActive {
        border-bottom-color: #8065e7;
        background: #fff;
        color: #5c49bc;
        font-weight: 800;
      }
      .entriesTabs strong,
      .entriesTabs em {
        min-width: 20px;
        padding: 2px 5px;
        border-radius: 999px;
        background: #eeeaf6;
        font-size: 10px;
      }
      .entriesTabs em {
        background: #ffe7df;
        color: #b54d37;
        font-size: 9px;
        font-style: normal;
        font-weight: 800;
      }
      .entriesList {
        max-height: calc(100vh - 330px);
        min-height: 510px;
        overflow: auto;
      }
      .entriesListRow {
        width: 100%;
        padding: 13px 14px;
        display: grid;
        gap: 7px;
        border: 0;
        border-bottom: 1px solid #f0edf5;
        border-left: 3px solid transparent;
        background: #fff;
        color: inherit;
        text-align: left;
      }
      .entriesListRow:hover {
        background: #fbf9ff;
      }
      .entriesListRow.isSelected {
        border-left-color: #846ee0;
        background: #f8f5ff;
      }
      .entriesListRow.isAlert:not(.isSelected) {
        border-left-color: #d96a54;
      }
      .entriesListRowTop {
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }
      .entriesListRowTop strong {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        line-height: 1.35;
      }
      .entriesListTags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .entriesListTags span {
        padding: 3px 6px;
        border-radius: 5px;
        background: #f1edff;
        color: #6f5bc7;
        font-size: 9px;
        font-weight: 700;
      }
      .entriesListMeta {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        color: #8a8693;
        font-size: 9px;
      }
      .entriesListMeta span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .entriesBadge {
        display: inline-flex;
        align-items: center;
        width: max-content;
        padding: 4px 7px;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 800;
        white-space: nowrap;
      }
      .entriesBadgeUrgent {
        background: #fff0df;
        color: #a65f1b;
      }
      .entriesBadgeAlert {
        background: #ffe7e2;
        color: #b44d3a;
      }
      .entriesBadgeQualify {
        background: #eee9ff;
        color: #6d56cb;
      }
      .entriesBadgeAssigned {
        background: #e8f2ff;
        color: #3275b7;
      }
      .entriesBadgeDone {
        background: #e6f6ec;
        color: #357d53;
      }
      .entriesEmpty {
        min-height: 300px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 7px;
        color: #8c8796;
        text-align: center;
      }
      .entriesEmpty strong {
        color: #686472;
        font-size: 12px;
      }
      .entriesEmpty span {
        font-size: 10px;
      }
      .entriesDetailPanel {
        overflow: auto;
        max-height: calc(100vh - 330px);
      }
      .entriesDetail {
        padding: 19px;
        display: grid;
        gap: 14px;
      }
      .entriesDetailHeader h2 {
        margin: 7px 0 4px;
        font-size: 19px;
        line-height: 1.28;
      }
      .entriesDetailHeader p {
        margin: 0;
        color: #8a8693;
        font-size: 10px;
      }
      .entriesDetailBadges {
        display: flex;
        gap: 6px;
      }
      .entriesDetailTabs {
        display: flex;
        align-items: center;
        gap: 5px;
        padding-bottom: 2px;
        border-bottom: 1px solid #e8e2f2;
        overflow-x: auto;
      }
      .entriesDetailTabs button {
        min-height: 31px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid transparent;
        border-radius: 8px 8px 0 0;
        background: transparent;
        color: #77717f;
        font-size: 10px;
        font-weight: 800;
        white-space: nowrap;
        cursor: pointer;
      }
      .entriesDetailTabs button.isActive {
        border-color: #dcd2f3;
        border-bottom-color: #fff;
        background: #f7f3ff;
        color: #5d4ca8;
      }
      .entriesDetailTabs button span {
        min-width: 18px;
        padding: 1px 5px;
        border-radius: 999px;
        background: #e9e2fb;
        color: #6554b5;
        font-size: 8px;
        text-align: center;
      }
      .entriesRawText {
        padding: 12px 13px;
        border: 1px solid #e8e2f2;
        border-radius: 9px;
        background: #faf8ff;
      }
      .entriesRawText > span {
        color: #7c6ab8;
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .entriesRawText p {
        margin: 6px 0 0;
        white-space: pre-wrap;
        font-size: 12px;
      }
      .entriesLinkedButton,
      .entriesLinkedGroup button {
        width: max-content;
        padding: 0;
        border: 0;
        background: transparent;
        color: #725bd4;
        font-size: 10px;
        font-weight: 750;
      }
      .entriesLinkedGroup {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        color: #8a8693;
        font-size: 10px;
      }
      .entriesDetailSection {
        padding: 14px;
        display: grid;
        gap: 11px;
        border: 1px solid #e9e5f0;
        border-radius: 10px;
      }
      .entriesSectionTitle {
        display: flex;
        align-items: center;
        gap: 7px;
        color: #504b59;
        font-size: 12px;
        font-weight: 800;
      }
      .entriesDetailTags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .entriesField {
        display: grid;
        gap: 5px;
        color: #5b5763;
        font-size: 10px;
        font-weight: 750;
      }
      .entriesTwoFields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .entriesSaveDraft {
        width: max-content;
      }
      .entriesActionSection {
        background: #fdfcff;
      }
      .entriesDivider {
        height: 1px;
        margin: 2px 0;
        background: #efecf4;
      }
      .entriesWarningSection {
        border-color: #ecd4ad;
        background: #fffbf2;
      }
      .entriesWarningSection p {
        margin: 0;
        color: #745c37;
        font-size: 11px;
      }
      .entriesReadOnlyNote {
        margin: 0;
        padding: 10px 12px;
        border-radius: 8px;
        background: #f4f2f7;
        color: #77717f;
        font-size: 10px;
      }
      .entriesDerivedBox {
        padding: 11px 13px;
        border: 1px dashed #dcd6e8;
        border-radius: 9px;
      }
      .entriesDerivedBox summary {
        cursor: pointer;
        color: #625d70;
        font-size: 10px;
        font-weight: 750;
      }
      .entriesDerivedBox p {
        margin: 9px 0;
        color: #8b8794;
        font-size: 10px;
      }
      .entriesDerivedBox button {
        margin-top: 8px;
      }
      .entriesAttachmentsSection {
        background: #fcfbff;
      }
      .entriesAttachmentCount {
        min-width: 20px;
        padding: 2px 6px;
        border-radius: 999px;
        background: #eee9ff;
        color: #6652c4;
        text-align: center;
        font-size: 9px;
      }
      .entriesAttachmentEmpty {
        margin: 0;
        color: #8b8794;
        font-size: 10px;
      }
      .entriesAttachmentList {
        display: grid;
        gap: 7px;
      }
      .entriesAttachmentRow {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) 32px 32px;
        gap: 7px;
        align-items: center;
        padding: 7px 8px;
        border: 1px solid #ece8f2;
        border-radius: 8px;
        background: #fff;
      }
      .entriesAttachmentThumbnail {
        width: 34px;
        height: 34px;
        padding: 0;
        overflow: hidden;
        border: 1px solid #ddd5ef;
        border-radius: 7px;
        background: #f2eefc;
        cursor: zoom-in;
      }
      .entriesAttachmentThumbnail img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
      }
      .entriesAttachmentIcon {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: #f2eefc;
        color: #755ed2;
      }
      .entriesAttachmentMeta {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .entriesAttachmentMeta strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
      }
      .entriesAttachmentMeta span {
        color: #918c99;
        font-size: 9px;
      }
      .entriesIconButton {
        width: 32px;
        height: 32px;
        padding: 0;
        display: grid;
        place-items: center;
        border: 1px solid #e3deea;
        border-radius: 7px;
        background: #fff;
        color: #706a79;
      }
      .entriesImageLightbox {
        position: fixed;
        inset: 0;
        z-index: 1100;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(23, 19, 30, 0.78);
      }
      .entriesImageLightboxContent {
        width: min(1100px, 95vw);
        max-height: 92vh;
        display: grid;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.3);
      }
      .entriesImageLightboxHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .entriesImageLightboxContent > img {
        display: block;
        max-width: 100%;
        max-height: calc(92vh - 68px);
        margin: auto;
        object-fit: contain;
      }
      .entriesAttachmentPreview {
        grid-column: 1/-1;
        padding-top: 4px;
      }
      .entriesAttachmentPreview img {
        display: block;
        max-width: 100%;
        max-height: 440px;
        margin: auto;
        border-radius: 8px;
      }
      .entriesAttachmentPreview iframe {
        width: 100%;
        height: 480px;
        border: 1px solid #e3deea;
        border-radius: 8px;
        background: #fff;
      }
      .entriesAttachmentAdd {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .entriesAssignmentSummary {
        padding: 13px;
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 14px;
        align-items: center;
        border: 1px solid #dce8f5;
        border-radius: 10px;
        background: #f7fbff;
      }
      .entriesAssignmentSummary.isOverdue {
        border-color: #ecc9c2;
        background: #fff7f5;
      }
      .entriesAssignmentSummary > div:not(.entriesOverdueLabel) {
        display: grid;
        gap: 3px;
      }
      .entriesAssignmentSummary span {
        color: #8a8693;
        font-size: 9px;
      }
      .entriesAssignmentSummary strong {
        font-size: 12px;
      }
      .entriesOverdueLabel {
        display: flex;
        align-items: center;
        gap: 5px;
        color: #b44d3a;
        font-size: 10px;
        font-weight: 800;
      }
      .entriesCompactSection strong {
        font-size: 10px;
        color: #6a6572;
      }
      .entriesCompactSection p {
        margin: -5px 0 2px;
        white-space: pre-wrap;
        font-size: 11px;
      }
      .entriesDoneSummary {
        padding: 14px;
        display: flex;
        gap: 10px;
        border: 1px solid #cde7d6;
        border-radius: 10px;
        background: #f4fbf7;
        color: #347d52;
      }
      .entriesDoneSummary > div {
        display: grid;
        gap: 3px;
      }
      .entriesDoneSummary span {
        font-size: 10px;
        color: #6f8a78;
      }
      .entriesDoneSummary p {
        margin: 5px 0 0;
        color: #4b5e51;
        font-size: 11px;
        white-space: pre-wrap;
      }
      .entriesHistory {
        padding-top: 2px;
        display: grid;
        gap: 8px;
      }
      .entriesHistory h3 {
        margin: 0 0 2px;
        font-size: 12px;
      }
      .entriesHistoryRow {
        display: grid;
        grid-template-columns: 14px 1fr;
        gap: 8px;
      }
      .entriesHistoryDot {
        width: 7px;
        height: 7px;
        margin-top: 4px;
        border-radius: 50%;
        background: #aa9bdd;
      }
      .entriesHistoryRow > div {
        display: grid;
        gap: 2px;
      }
      .entriesHistoryRow strong {
        font-size: 10px;
        font-weight: 650;
      }
      .entriesHistoryRow span:last-child {
        color: #96919e;
        font-size: 9px;
      }
      .entriesLoading {
        min-height: 360px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        color: #77717f;
        font-size: 12px;
      }
      .entriesSpin {
        animation: entriesSpin 1s linear infinite;
      }
      @keyframes entriesSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 1120px) {
        .entriesMainGrid {
          grid-template-columns: minmax(300px, 0.72fr) minmax(420px, 1.28fr);
        }
        .entriesQuickCaptureMain {
          grid-template-columns: 32px minmax(0, 1fr);
        }
        .entriesAddButton {
          grid-column: 2;
          width: max-content;
        }
        .entriesQuickOptions,
        .entriesCaptureHint,
        .entriesPendingFiles {
          padding-left: 42px;
        }
      }
      @media (max-width: 900px) {
        .entriesMainGrid {
          grid-template-columns: 1fr;
        }
        .entriesList,
        .entriesDetailPanel {
          max-height: none;
          min-height: 0;
        }
        .entriesDetailPanel {
          overflow: visible;
        }
        .entriesTwoFields {
          grid-template-columns: 1fr;
        }
        .entriesTagAdminRow {
          grid-template-columns: minmax(120px, 1fr) auto 30px 30px;
        }
        .entriesTagAdminRow .entriesTinyButton {
          grid-column: 1/-1;
          width: max-content;
        }
      }
      @media (max-width: 620px) {
        .entriesPageHeading {
          flex-direction: column;
        }
        .entriesQuickCaptureMain {
          grid-template-columns: 1fr;
        }
        .entriesCaptureIcon {
          display: none;
        }
        .entriesAddButton {
          grid-column: auto;
          width: 100%;
        }
        .entriesQuickOptions,
        .entriesCaptureHint,
        .entriesPendingFiles {
          padding-left: 0;
        }
        .entriesTabs button {
          flex-wrap: wrap;
          gap: 4px;
        }
        .entriesAssignmentSummary {
          grid-template-columns: 1fr;
        }
        .entriesAttachmentRow {
          grid-template-columns: 32px minmax(0, 1fr) 32px;
        }
        .entriesAttachmentRow > a {
          grid-column: 3;
        }
        .entriesAttachmentRow > button {
          grid-column: 3;
        }
        .entriesAttachmentPreview {
          grid-column: 1/-1;
        }
      }
    `}</style>
  );
}
