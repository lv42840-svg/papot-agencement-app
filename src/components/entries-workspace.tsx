"use client";

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
  corps: MutationBody,
  successMessage?: string,
) => Promise<EntriesApiSnapshot | null>;
type UploadFn = (idEntree: string, fichiers: File[]) => Promise<boolean>;
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

function formatDateTime(valeur: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(valeur),
  );
}

function formatDateOnly(valeur: string | null): string {
  if (!valeur) return "Sans date";
  const [annee, mois, jour] = valeur.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(annee, mois - 1, jour, 12),
  );
}

function formatBytes(valeur: number): string {
  if (valeur < 1024) return `${valeur} o`;
  if (valeur < 1024 * 1024) return `${Math.round(valeur / 1024)} Ko`;
  return `${(valeur / (1024 * 1024)).toFixed(valeur >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
}

function entryTagLabels(entree: EntryRecord, etiquettes: EntriesTag[]): EntriesTag[] {
  const selectionne = new Set(entree.tagIds);
  return etiquettes
    .filter((etiquette) => selectionne.has(etiquette.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function attentionText(entree: EntryRecord): string | null {
  if (entree.status !== "TO_QUALIFY") return null;
  if (entree.snoozedUntilDate)
    return `Reportée jusqu'au ${formatDateOnly(entree.snoozedUntilDate)}`;
  return `Remontée à partir du ${formatDateTime(qualificationAttentionAt(entree).toISOString())}`;
}

export function EntriesWorkspace() {
  const [snapshot, setSnapshot] = useState<EntriesApiSnapshot | null>(null);
  const [tab, setTab] = useState<EntriesTab>("TO_QUALIFY");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chargement, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reponse = await fetch("/api/desktop/entries", { cache: "no-store" });
      const corps = (await reponse.json()) as EntriesApiSnapshot & { error?: string };
      if (!reponse.ok) throw new Error(corps.error ?? "ENTRIES_LOAD_FAILED");
      setSnapshot(corps);
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
    async (corps, successMessage) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const reponse = await fetch("/api/desktop/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corps),
        });
        const resultat = (await reponse.json()) as EntriesApiSnapshot & {
          error?: string;
          lockedBy?: string;
        };
        if (!reponse.ok) {
          const base =
            errorMessages[resultat.error ?? ""] ?? "L'action n'a pas pu être enregistrée.";
          throw new Error(
            resultat.lockedBy ? `${base} Poste en cours : ${resultat.lockedBy}.` : base,
          );
        }
        setSnapshot(resultat);
        if (resultat.focusEntryId) setSelectedId(resultat.focusEntryId);
        if (successMessage) setNotice(successMessage);
        return resultat;
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

  const uploadAttachments = useCallback<UploadFn>(async (idEntree, fichiers) => {
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
      const resultat = (await reponse.json()) as EntriesApiSnapshot & { error?: string };
      if (!reponse.ok) {
        throw new Error(
          errorMessages[resultat.error ?? ""] ??
            "Les pièces jointes n'ont pas pu être enregistrées.",
        );
      }
      setSnapshot(resultat);
      setSelectedId(idEntree);
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

  const contenu = snapshot?.payload;
  const maintenant = useMemo(
    () => new Date(snapshot?.serverNow ?? Date.now()),
    [snapshot?.serverNow],
  );
  const qualifyEntries = useMemo(
    () =>
      (contenu?.entries ?? [])
        .filter((entree) => entree.status === "TO_QUALIFY")
        .sort((a, b) => {
          const attentionDelta =
            Number(isQualificationAttentionDue(b, maintenant)) -
            Number(isQualificationAttentionDue(a, maintenant));
          return attentionDelta || a.createdAt.localeCompare(b.createdAt);
        }),
    [contenu?.entries, maintenant],
  );
  const assignedEntries = useMemo(
    () =>
      (contenu?.entries ?? [])
        .filter((entree) => entree.status === "ASSIGNED")
        .sort((a, b) => {
          const overdueDelta =
            Number(isAssignedOverdue(b, maintenant)) - Number(isAssignedOverdue(a, maintenant));
          return (
            overdueDelta || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
          );
        }),
    [contenu?.entries, maintenant],
  );
  const doneEntries = useMemo(
    () =>
      (contenu?.entries ?? [])
        .filter((entree) => entree.status === "DONE")
        .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)),
    [contenu?.entries],
  );

  const visibleEntries =
    tab === "TO_QUALIFY" ? qualifyEntries : tab === "ASSIGNED" ? assignedEntries : doneEntries;
  const selectedEntry =
    contenu?.entries.find((entree) => entree.id === selectedId) ?? visibleEntries[0] ?? null;

  useEffect(() => {
    if (selectedEntry && selectedEntry.id !== selectedId) setSelectedId(selectedEntry.id);
    if (!selectedEntry && selectedId) setSelectedId(null);
  }, [selectedEntry, selectedId]);

  const unreadNotifications = useMemo(() => {
    if (!snapshot) return [];
    const auteur = normalizePersonName(snapshot.actor.displayName);
    return snapshot.payload.notifications
      .filter(
        (notification) =>
          !notification.readAt && normalizePersonName(notification.recipientName) === auteur,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [snapshot]);

  if (chargement && !snapshot) {
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

      {erreur ? <div className="entriesMessage entriesMessageError">{erreur}</div> : null}
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
                  qualifyEntries.filter((entree) => isQualificationAttentionDue(entree, maintenant))
                    .length
                }
                onClick={() => setTab("TO_QUALIFY")}
              />
              <TabButton
                active={tab === "ASSIGNED"}
                label="Affectées"
                count={assignedEntries.length}
                alertCount={
                  assignedEntries.filter((entree) => isAssignedOverdue(entree, maintenant)).length
                }
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
                visibleEntries.map((entree) => (
                  <EntryListRow
                    key={entree.id}
                    entry={entree}
                    tags={snapshot.payload.tags}
                    now={maintenant}
                    selected={entree.id === selectedEntry?.id}
                    onClick={() => setSelectedId(entree.id)}
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
                now={maintenant}
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
  label: libelle,
  count: nombre,
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
      <span>{libelle}</span>
      <strong>{nombre}</strong>
      {alertCount > 0 ? <em>{alertCount}</em> : null}
    </button>
  );
}

function EntryListRow({
  entry: entree,
  tags: etiquettes,
  now: maintenant,
  selected: selectionne,
  onClick,
}: {
  entry: EntryRecord;
  tags: EntriesTag[];
  now: Date;
  selected: boolean;
  onClick: () => void;
}) {
  const attention = isQualificationAttentionDue(entree, maintenant);
  const overdue = isAssignedOverdue(entree, maintenant);
  return (
    <button
      type="button"
      className={`entriesListRow${selectionne ? " isSelected" : ""}${attention || overdue ? " isAlert" : ""}`}
      onClick={onClick}
    >
      <div className="entriesListRowTop">
        <strong>{entree.rawText}</strong>
        {entree.priority === "URGENT" ? (
          <span className="entriesBadge entriesBadgeUrgent">Urgent</span>
        ) : null}
        {attention ? <span className="entriesBadge entriesBadgeAlert">À remonter</span> : null}
        {overdue ? <span className="entriesBadge entriesBadgeAlert">En retard</span> : null}
      </div>
      <div className="entriesListTags">
        {entryTagLabels(entree, etiquettes).map((etiquette) => (
          <span key={etiquette.id}>{etiquette.label}</span>
        ))}
      </div>
      <div className="entriesListMeta">
        {entree.attachments.length > 0 ? (
          <span>
            <Paperclip size={12} /> {entree.attachments.length}
          </span>
        ) : null}
        {entree.status === "TO_QUALIFY" ? (
          <span>
            <Clock3 size={12} />{" "}
            {entree.snoozedUntilDate
              ? attentionText(entree)
              : `Créée ${formatDateTime(entree.createdAt)}`}
          </span>
        ) : entree.status === "ASSIGNED" ? (
          <>
            <span>
              <UserRound size={12} /> {entree.assigneeName}
            </span>
            <span>
              <Clock3 size={12} /> {formatDateOnly(entree.dueDate)}
            </span>
          </>
        ) : (
          <span>
            <Check size={12} /> Terminée{" "}
            {entree.completedAt ? formatDateTime(entree.completedAt) : ""}
          </span>
        )}
      </div>
    </button>
  );
}

function EntryDetail({
  entry: entree,
  payload: contenu,
  actorName,
  capabilities,
  suggestedAssignees,
  busy,
  now: maintenant,
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
  onOpenEntry: (idEntree: string) => void;
}) {
  const [description, setDescription] = useState(entree.structuredDescription ?? entree.rawText);
  const nextAction = entree.nextAction ?? "";
  const [tagIds, setTagIds] = useState(entree.tagIds);
  const [actionDrafts, setActionDrafts] = useState<NextActionDraft[]>(() => [
    {
      id: `action-${entree.id}-1`,
      text: entree.status === "TO_QUALIFY" ? (entree.nextAction ?? "") : "",
      assigneeName: "",
      dueDate: "",
    },
  ]);
  const [resultat, setResult] = useState(entree.result ?? "");
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [derivedText, setDerivedText] = useState("");
  const [detailTab, setDetailTab] = useState<EntryDetailTab>("INFO");

  const canActAssigned =
    entree.status === "ASSIGNED" &&
    Boolean(entree.assigneeName) &&
    normalizePersonName(entree.assigneeName ?? "") === normalizePersonName(actorName);
  const attentionDue = isQualificationAttentionDue(entree, maintenant);
  const overdue = isAssignedOverdue(entree, maintenant);
  const visibleTags = contenu.tags
    .filter((etiquette) => etiquette.active || tagIds.includes(etiquette.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const latestReassignment = [...entree.history]
    .reverse()
    .find((evenement) => evenement.type === "REASSIGNED");

  return (
    <div className="entriesDetail">
      <div className="entriesDetailHeader">
        <div className="entriesDetailBadges">
          <StatusBadge entry={entree} now={maintenant} />
          {entree.priority === "URGENT" ? (
            <span className="entriesBadge entriesBadgeUrgent">Urgent</span>
          ) : null}
        </div>
        <h2>{entree.rawText}</h2>
        <p>
          Créée par {entree.createdByName} le {formatDateTime(entree.createdAt)}
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
          {entree.attachments.length > 0 ? <span>{entree.attachments.length}</span> : null}
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
            <p>{entree.rawText}</p>
          </div>

          {entree.parentEntryId ? (
            <button
              type="button"
              className="entriesLinkedButton"
              onClick={() => onOpenEntry(entree.parentEntryId!)}
            >
              Entrée d'origine
            </button>
          ) : null}
          {entree.derivedEntryIds.length > 0 ? (
            <div className="entriesLinkedGroup">
              <span>
                Entrée{entree.derivedEntryIds.length > 1 ? "s" : ""} dérivée
                {entree.derivedEntryIds.length > 1 ? "s" : ""}
              </span>
              {entree.derivedEntryIds.map((id, indice) => (
                <button type="button" key={id} onClick={() => onOpenEntry(id)}>
                  Ouvrir #{indice + 1}
                </button>
              ))}
            </div>
          ) : null}

          {entree.status === "TO_QUALIFY" ? (
            <>
              <section className="entriesDetailSection">
                <div className="entriesSectionTitle">
                  <Tag size={15} /> Qualification
                </div>
                {capabilities.canQualify ? (
                  <>
                    <div className="entriesDetailTags">
                      {visibleTags.map((etiquette) => (
                        <button
                          key={etiquette.id}
                          type="button"
                          className={`entriesTagChoice${tagIds.includes(etiquette.id) ? " isSelected" : ""}`}
                          onClick={() =>
                            setTagIds((courant) =>
                              courant.includes(etiquette.id)
                                ? courant.filter((id) => id !== etiquette.id)
                                : [...courant, etiquette.id],
                            )
                          }
                        >
                          {etiquette.label}
                          {!etiquette.active ? " (désactivé)" : ""}
                        </button>
                      ))}
                    </div>
                    <label className="entriesField">
                      <span>C'est quoi ?</span>
                      <textarea
                        rows={3}
                        value={description}
                        onChange={(evenement) => setDescription(evenement.target.value)}
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
                            entryId: entree.id,
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
                    {actionDrafts.map((actionDraft, indice) => (
                      <div className="entriesNextActionCard" key={actionDraft.id}>
                        <div className="entriesNextActionHeader">
                          <strong>Action suivante {indice + 1}</strong>
                          {actionDrafts.length > 1 ? (
                            <button
                              type="button"
                              className="entriesIconButton"
                              title="Supprimer cette action"
                              onClick={() =>
                                setActionDrafts((courant) =>
                                  courant.filter((element) => element.id !== actionDraft.id),
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
                            onChange={(evenement) =>
                              setActionDrafts((courant) =>
                                courant.map((element) =>
                                  element.id === actionDraft.id
                                    ? { ...element, text: evenement.target.value }
                                    : element,
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
                              list={`entry-assignees-${entree.id}`}
                              value={actionDraft.assigneeName}
                              onChange={(evenement) =>
                                setActionDrafts((courant) =>
                                  courant.map((element) =>
                                    element.id === actionDraft.id
                                      ? { ...element, assigneeName: evenement.target.value }
                                      : element,
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
                              onChange={(evenement) =>
                                setActionDrafts((courant) =>
                                  courant.map((element) =>
                                    element.id === actionDraft.id
                                      ? { ...element, dueDate: evenement.target.value }
                                      : element,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <datalist id={`entry-assignees-${entree.id}`}>
                      {suggestedAssignees.map((nom) => (
                        <option value={nom} key={nom} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={busy || actionDrafts.length >= 20}
                      onClick={() =>
                        setActionDrafts((courant) => [
                          ...courant,
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
                          (element) =>
                            !element.text.trim() ||
                            !element.assigneeName.trim() ||
                            !element.dueDate,
                        )
                      }
                      onClick={() =>
                        void mutate(
                          {
                            action: "qualifyActions",
                            entryId: entree.id,
                            description,
                            tagIds,
                            actions: actionDrafts.map((element) => ({
                              text: element.text,
                              assigneeName: element.assigneeName,
                              dueDate: element.dueDate,
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
                      value={resultat}
                      onChange={(evenement) => setResult(evenement.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        { action: "qualifyDone", entryId: entree.id, result: resultat, tagIds },
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
                        onChange={(evenement) => setSnoozeDate(evenement.target.value)}
                      />
                    </label>
                    <label className="entriesField">
                      <span>Motif obligatoire</span>
                      <input
                        value={snoozeReason}
                        onChange={(evenement) => setSnoozeReason(evenement.target.value)}
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
                          entryId: entree.id,
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
                    onChange={(evenement) => setDerivedText(evenement.target.value)}
                  />
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busy || !derivedText.trim()}
                    onClick={() =>
                      void mutate(
                        { action: "derive", entryId: entree.id, rawText: derivedText },
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

          {entree.status === "ASSIGNED" ? (
            <>
              <section className={`entriesAssignmentSummary${overdue ? " isOverdue" : ""}`}>
                <div>
                  <span>Responsable</span>
                  <strong>{entree.assigneeName}</strong>
                </div>
                <div>
                  <span>Échéance</span>
                  <strong>{formatDateOnly(entree.dueDate)}</strong>
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
              {entree.structuredDescription ? (
                <section className="entriesDetailSection entriesCompactSection">
                  <strong>C'est quoi ?</strong>
                  <p>{entree.structuredDescription}</p>
                  <strong>J'en fais quoi ?</strong>
                  <p>{entree.nextAction || "Non renseigné"}</p>
                </section>
              ) : null}
              {canActAssigned ? (
                <section className="entriesDetailSection entriesActionSection">
                  <div className="entriesSectionTitle">
                    <Clock3 size={15} /> Mes actions
                  </div>
                  <div className="entriesNextActions">
                    {actionDrafts.map((actionDraft, indice) => (
                      <div className="entriesNextActionCard" key={actionDraft.id}>
                        <div className="entriesNextActionHeader">
                          <strong>Nouvelle action {indice + 1}</strong>
                          {actionDrafts.length > 1 ? (
                            <button
                              type="button"
                              className="entriesIconButton"
                              title="Supprimer cette action"
                              onClick={() =>
                                setActionDrafts((courant) =>
                                  courant.filter((element) => element.id !== actionDraft.id),
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
                            onChange={(evenement) =>
                              setActionDrafts((courant) =>
                                courant.map((element) =>
                                  element.id === actionDraft.id
                                    ? { ...element, text: evenement.target.value }
                                    : element,
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
                              list={`entry-assigned-actions-${entree.id}`}
                              value={actionDraft.assigneeName}
                              onChange={(evenement) =>
                                setActionDrafts((courant) =>
                                  courant.map((element) =>
                                    element.id === actionDraft.id
                                      ? { ...element, assigneeName: evenement.target.value }
                                      : element,
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
                              onChange={(evenement) =>
                                setActionDrafts((courant) =>
                                  courant.map((element) =>
                                    element.id === actionDraft.id
                                      ? { ...element, dueDate: evenement.target.value }
                                      : element,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <datalist id={`entry-assigned-actions-${entree.id}`}>
                      {suggestedAssignees.map((nom) => (
                        <option value={nom} key={nom} />
                      ))}
                    </datalist>
                    <div className="buttonRow">
                      <button
                        type="button"
                        className="secondaryButton"
                        disabled={busy || actionDrafts.length >= 20}
                        onClick={() =>
                          setActionDrafts((courant) => [
                            ...courant,
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
                            (element) =>
                              !element.text.trim() ||
                              !element.assigneeName.trim() ||
                              !element.dueDate,
                          )
                        }
                        onClick={() =>
                          void mutate(
                            {
                              action: "assignedActions",
                              entryId: entree.id,
                              actions: actionDrafts.map((element) => ({
                                text: element.text,
                                assigneeName: element.assigneeName,
                                dueDate: element.dueDate,
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
                      value={resultat}
                      onChange={(evenement) => setResult(evenement.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        { action: "complete", entryId: entree.id, result: resultat },
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
                        onChange={(evenement) => setPostponeDate(evenement.target.value)}
                      />
                    </label>
                    <label className="entriesField">
                      <span>Motif obligatoire</span>
                      <input
                        value={postponeReason}
                        onChange={(evenement) => setPostponeReason(evenement.target.value)}
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
                          entryId: entree.id,
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
                        list={`reassign-${entree.id}`}
                        value={newAssignee}
                        onChange={(evenement) => setNewAssignee(evenement.target.value)}
                      />
                      <datalist id={`reassign-${entree.id}`}>
                        {suggestedAssignees.map((nom) => (
                          <option value={nom} key={nom} />
                        ))}
                      </datalist>
                    </label>
                    <label className="entriesField">
                      <span>Motif obligatoire</span>
                      <input
                        value={reassignReason}
                        onChange={(evenement) => setReassignReason(evenement.target.value)}
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
                          entryId: entree.id,
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

          {entree.status === "DONE" ? (
            <section className="entriesDoneSummary">
              <CheckCircle2 size={22} />
              <div>
                <strong>Terminée</strong>
                <span>{entree.completedAt ? formatDateTime(entree.completedAt) : ""}</span>
                {entree.result ? <p>{entree.result}</p> : null}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {detailTab === "AFFAIR" ? (
        <TaskCommercialBridge task={entree} description={description} nextAction={nextAction} />
      ) : null}

      {detailTab === "ATTACHMENTS" ? (
        <EntryAttachments entry={entree} busy={busy} uploadAttachments={uploadAttachments} />
      ) : null}

      {detailTab === "HISTORY" ? (
        <section className="entriesHistory">
          <h3>Historique</h3>
          {[...entree.history].reverse().map((evenement) => (
            <div className="entriesHistoryRow" key={evenement.id}>
              <span className="entriesHistoryDot" />
              <div>
                <strong>{evenement.summary}</strong>
                <span>
                  {evenement.actorName} · {formatDateTime(evenement.at)}
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
  entry: entree,
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
        <span className="entriesAttachmentCount">{entree.attachments.length}</span>
      </div>
      {entree.attachments.length === 0 ? (
        <p className="entriesAttachmentEmpty">
          Aucune pièce jointe. Les originaux sont conservés dans le stockage PAPOT.
        </p>
      ) : (
        <div className="entriesAttachmentList">
          {entree.attachments.map((pieceJointe) => (
            <AttachmentRow
              key={pieceJointe.id}
              entryId={entree.id}
              attachment={pieceJointe}
              preview={previewId === pieceJointe.id}
              onPreview={() =>
                setPreviewId((courant) => (courant === pieceJointe.id ? null : pieceJointe.id))
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
              void uploadAttachments(entree.id, pending).then((ok) => {
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
  entryId: idEntree,
  attachment: pieceJointe,
  preview: apercu,
  onPreview,
}: {
  entryId: string;
  attachment: EntryAttachment;
  preview: boolean;
  onPreview: () => void;
}) {
  const url = `/api/desktop/entries/${idEntree}/attachments/${pieceJointe.id}`;
  const isImage = pieceJointe.contentType.startsWith("image/");
  const isPdf = pieceJointe.contentType === "application/pdf";
  return (
    <div className="entriesAttachmentRow">
      {isImage ? (
        <button
          type="button"
          className="entriesAttachmentThumbnail"
          onClick={onPreview}
          title="Voir l’image en grand"
          aria-label={`Voir ${pieceJointe.fileName} en grand`}
        >
          <img src={url} alt="" />
        </button>
      ) : (
        <div className="entriesAttachmentIcon">
          <FileText size={18} />
        </div>
      )}
      <div className="entriesAttachmentMeta">
        <strong title={pieceJointe.fileName}>{pieceJointe.fileName}</strong>
        <span>
          {formatBytes(pieceJointe.sizeBytes)} · ajouté par {pieceJointe.uploadedByName} le{" "}
          {formatDateTime(pieceJointe.uploadedAt)}
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
        download={pieceJointe.fileName}
      >
        <Download size={16} />
      </a>
      {apercu && isImage ? (
        <div
          className="entriesImageLightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Aperçu de ${pieceJointe.fileName}`}
          onClick={onPreview}
        >
          <div
            className="entriesImageLightboxContent"
            onClick={(evenement) => evenement.stopPropagation()}
          >
            <div className="entriesImageLightboxHeader">
              <strong>{pieceJointe.fileName}</strong>
              <button
                type="button"
                className="entriesIconButton"
                onClick={onPreview}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>
            <img src={url} alt={pieceJointe.fileName} />
          </div>
        </div>
      ) : apercu && isPdf ? (
        <div className="entriesAttachmentPreview">
          <iframe title={pieceJointe.fileName} src={url} />
        </div>
      ) : null}
    </div>
  );
}

function FilePicker({
  label: libelle,
  files: fichiers,
  onChange,
  disabled: desactive,
}: {
  label: string;
  files: File[];
  onChange: (fichiers: File[]) => void;
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
        disabled={desactive}
        onChange={(evenement) => {
          const selectionne = Array.from(evenement.target.files ?? []);
          onChange([...fichiers, ...selectionne].slice(0, 12));
          evenement.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        className="entriesFileButton"
        disabled={desactive}
        onClick={() => ref.current?.click()}
      >
        <Paperclip size={14} /> {libelle}
        {fichiers.length > 0 ? ` (${fichiers.length})` : ""}
      </button>
    </>
  );
}

function PendingFiles({
  files: fichiers,
  onChange,
  compact = false,
}: {
  files: File[];
  onChange: (fichiers: File[]) => void;
  compact?: boolean;
}) {
  return (
    <div className={`entriesPendingFiles${compact ? " isCompact" : ""}`}>
      {fichiers.map((fichier, indice) => (
        <PendingFile
          key={`${fichier.name}-${fichier.lastModified}-${indice}`}
          file={fichier}
          onRemove={() => onChange(fichiers.filter((_, fileIndex) => fileIndex !== indice))}
        />
      ))}
    </div>
  );
}

function PendingFile({ file: fichier, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = fichier.type.startsWith("image/");
  useEffect(() => {
    if (!image) return;
    const suivant = URL.createObjectURL(fichier);
    setUrl(suivant);
    return () => URL.revokeObjectURL(suivant);
  }, [fichier, image]);
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
        <strong>{fichier.name}</strong>
        <span>{formatBytes(fichier.size)}</span>
      </div>
      <button type="button" title="Retirer" onClick={onRemove}>
        <X size={15} />
      </button>
    </div>
  );
}

function StatusBadge({ entry: entree, now: maintenant }: { entry: EntryRecord; now: Date }) {
  if (entree.status === "DONE")
    return <span className="entriesBadge entriesBadgeDone">Terminée</span>;
  if (entree.status === "ASSIGNED")
    return isAssignedOverdue(entree, maintenant) ? (
      <span className="entriesBadge entriesBadgeAlert">En retard</span>
    ) : (
      <span className="entriesBadge entriesBadgeAssigned">Affectée</span>
    );
  return isQualificationAttentionDue(entree, maintenant) ? (
    <span className="entriesBadge entriesBadgeAlert">À remonter</span>
  ) : (
    <span className="entriesBadge entriesBadgeQualify">À qualifier</span>
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
      .entriesNextActions {
        display: grid;
        gap: 10px;
      }
      .entriesNextActionCard {
        display: grid;
        gap: 10px;
        padding: 11px;
        border: 1px solid #e8e2f2;
        border-radius: 9px;
        background: #fff;
      }
      .entriesNextActionHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .entriesNextActionHeader strong {
        color: #625d70;
        font-size: 10px;
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
