import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  normalizePersonName,
  parisDateKey,
  type EntriesPayload,
  type EntryAttachment,
  type EntryRecord,
} from "./domain";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const tagIdsSchema = z.array(z.string().min(1).max(100)).max(12);

export const entriesMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    entryId: z.string().uuid().optional(),
    rawText: z.string().trim().min(1).max(4000),
    priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
    tagIds: tagIdsSchema.default([]),
    clientId: z.string().uuid().nullable().optional(),
    commercialCaseId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal("qualifyDraft"),
    entryId: z.string().uuid(),
    description: z.string().trim().max(4000),
    nextAction: z.string().trim().max(2000),
    tagIds: tagIdsSchema,
  }),
  z.object({
    action: z.literal("qualifyAssign"),
    entryId: z.string().uuid(),
    description: z.string().trim().min(1).max(4000),
    nextAction: z.string().trim().min(1).max(2000),
    assigneeName: z.string().trim().min(1).max(120),
    dueDate: dateOnlySchema,
    tagIds: tagIdsSchema,
  }),
  z.object({
    action: z.literal("qualifyActions"),
    entryId: z.string().uuid(),
    description: z.string().trim().min(1).max(4000),
    tagIds: tagIdsSchema,
    actions: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(2000),
          assigneeName: z.string().trim().min(1).max(120),
          dueDate: dateOnlySchema,
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    action: z.literal("updateAssigned"),
    entryId: z.string().uuid(),
    description: z.string().trim().min(1).max(4000),
    nextAction: z.string().trim().min(1).max(2000),
    priority: z.enum(["NORMAL", "URGENT"]),
    tagIds: tagIdsSchema,
  }),
  z.object({
    action: z.literal("assignedActions"),
    entryId: z.string().uuid(),
    actions: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(2000),
          assigneeName: z.string().trim().min(1).max(120),
          dueDate: dateOnlySchema,
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    action: z.literal("qualifyDone"),
    entryId: z.string().uuid(),
    result: z.string().trim().max(4000).optional().default(""),
    tagIds: tagIdsSchema,
  }),
  z.object({
    action: z.literal("snooze"),
    entryId: z.string().uuid(),
    untilDate: dateOnlySchema,
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    action: z.literal("postpone"),
    entryId: z.string().uuid(),
    dueDate: dateOnlySchema,
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    action: z.literal("reassign"),
    entryId: z.string().uuid(),
    assigneeName: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    action: z.literal("complete"),
    entryId: z.string().uuid(),
    result: z.string().trim().max(4000).optional().default(""),
  }),
  z.object({
    action: z.literal("derive"),
    entryId: z.string().uuid(),
    rawText: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("notificationRead"),
    notificationId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("tagAdd"),
    label: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("tagUpdate"),
    tagId: z.string().min(1).max(100),
    label: z.string().trim().min(1).max(80),
    active: z.boolean(),
  }),
  z.object({
    action: z.literal("tagMove"),
    tagId: z.string().min(1).max(100),
    direction: z.enum(["up", "down"]),
  }),
]);

export type EntriesMutation = z.infer<typeof entriesMutationSchema>;
export type EntriesActor = {
  userId: string;
  displayName: string;
  canQualify?: boolean;
  canManageTags?: boolean;
  assignmentCandidates?: string[];
  notificationRecipients?: string[];
};
export type EntriesCapabilities = { canQualify: boolean; canManageTags: boolean };
export type EntriesMutationResult = { payload: EntriesPayload; focusEntryId?: string };

export function entriesCapabilities(auteur: EntriesActor): EntriesCapabilities {
  return {
    canQualify: auteur.canQualify === true,
    canManageTags: auteur.canManageTags === true,
  };
}

function requireCapability(valeur: boolean, code: string): void {
  if (!valeur) throw new Error(code);
}

function findEntry(contenu: EntriesPayload, idEntree: string): EntryRecord {
  const entree = contenu.entries.find((candidat) => candidat.id === idEntree);
  if (!entree) throw new Error("ENTRY_NOT_FOUND");
  return entree;
}

function assertToQualify(entree: EntryRecord): void {
  if (entree.status !== "TO_QUALIFY") throw new Error("ENTRY_NOT_TO_QUALIFY");
}

function assertAssignedToActor(entree: EntryRecord, auteur: EntriesActor): void {
  if (entree.status !== "ASSIGNED") throw new Error("ENTRY_NOT_ASSIGNED");
  if (
    !entree.assigneeName ||
    normalizePersonName(entree.assigneeName) !== normalizePersonName(auteur.displayName)
  ) {
    throw new Error("ENTRY_NOT_ASSIGNED_TO_ACTOR");
  }
}

function ensureTagIds(contenu: EntriesPayload, tagIds: string[]): void {
  const known = new Set(contenu.tags.map((etiquette) => etiquette.id));
  if (tagIds.some((tagId) => !known.has(tagId))) throw new Error("ENTRY_TAG_UNKNOWN");
}

function history(
  entree: EntryRecord,
  auteur: EntriesActor,
  type: EntryRecord["history"][number]["type"],
  summary: string,
  maintenant: string,
): void {
  entree.history.push({
    id: randomUUID(),
    type,
    at: maintenant,
    actorName: auteur.displayName,
    summary,
  });
}

function notify(
  contenu: EntriesPayload,
  idEntree: string,
  recipientName: string,
  message: string,
  maintenant: string,
): void {
  contenu.notifications.push({
    id: randomUUID(),
    entryId: idEntree,
    recipientName,
    createdAt: maintenant,
    message,
    readAt: null,
  });
}

function ensureUniqueTagLabel(contenu: EntriesPayload, libelle: string, exceptId?: string): void {
  const cle = normalizePersonName(libelle);
  if (
    contenu.tags.some(
      (etiquette) => etiquette.id !== exceptId && normalizePersonName(etiquette.label) === cle,
    )
  ) {
    throw new Error("TAG_LABEL_EXISTS");
  }
}

function slugifyTag(libelle: string): string {
  const base = normalizePersonName(libelle)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "tag"}-${randomUUID().slice(0, 8)}`;
}

export function registerEntryAttachments(
  source: EntriesPayload,
  idEntree: string,
  piecesJointes: EntryAttachment[],
  auteur: EntriesActor,
  nowDate: Date = new Date(),
): EntriesMutationResult {
  const contenu = structuredClone(source);
  const entree = findEntry(contenu, idEntree);
  const knownIds = new Set(entree.attachments.map((element) => element.id));
  const knownPaths = new Set(entree.attachments.map((element) => element.storagePath));
  if (
    piecesJointes.some((element) => knownIds.has(element.id) || knownPaths.has(element.storagePath))
  ) {
    throw new Error("ENTRY_ATTACHMENT_DUPLICATE");
  }
  entree.attachments.push(...piecesJointes);
  if (piecesJointes.length > 0) {
    const noms = piecesJointes
      .slice(0, 3)
      .map((element) => element.fileName)
      .join(", ");
    const suffix = piecesJointes.length > 3 ? ` +${piecesJointes.length - 3}` : "";
    history(
      entree,
      auteur,
      "ATTACHMENTS_ADDED",
      `${piecesJointes.length} pièce${piecesJointes.length > 1 ? "s" : ""} jointe${piecesJointes.length > 1 ? "s" : ""} ajoutée${piecesJointes.length > 1 ? "s" : ""} : ${noms}${suffix}.`,
      nowDate.toISOString(),
    );
  }
  return { payload: contenu, focusEntryId: entree.id };
}

export function applyEntriesMutation(
  source: EntriesPayload,
  saisie: EntriesMutation,
  auteur: EntriesActor,
  nowDate: Date = new Date(),
): EntriesMutationResult {
  const contenu = structuredClone(source);
  const capabilities = entriesCapabilities(auteur);
  const maintenant = nowDate.toISOString();

  if (saisie.action === "create") {
    const existing = saisie.entryId
      ? contenu.entries.find((entree) => entree.id === saisie.entryId)
      : undefined;
    if (existing) {
      if (existing.rawText !== saisie.rawText || existing.priority !== saisie.priority)
        throw new Error("CAPTURE_REQUEST_CONFLICT");
      return { payload: contenu, focusEntryId: existing.id };
    }
    ensureTagIds(contenu, saisie.tagIds);
    const entree: EntryRecord = {
      id: saisie.entryId ?? randomUUID(),
      rawText: saisie.rawText,
      structuredDescription: null,
      nextAction: null,
      tagIds: [...saisie.tagIds],
      priority: saisie.priority,
      status: "TO_QUALIFY",
      createdAt: maintenant,
      createdByName: auteur.displayName,
      assigneeName: null,
      dueDate: null,
      snoozedUntilDate: null,
      result: null,
      completedAt: null,
      parentEntryId: null,
      clientId: saisie.clientId ?? null,
      commercialCaseId: saisie.commercialCaseId ?? null,
      derivedEntryIds: [],
      attachments: [],
      history: [],
    };
    history(entree, auteur, "CREATED", "Entrée créée dans À qualifier.", maintenant);
    contenu.entries.unshift(entree);
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "notificationRead") {
    const notification = contenu.notifications.find(
      (element) => element.id === saisie.notificationId,
    );
    if (!notification) throw new Error("NOTIFICATION_NOT_FOUND");
    if (
      normalizePersonName(notification.recipientName) !== normalizePersonName(auteur.displayName)
    ) {
      throw new Error("NOTIFICATION_FORBIDDEN");
    }
    notification.readAt = maintenant;
    return { payload: contenu, focusEntryId: notification.entryId };
  }

  if (saisie.action === "tagAdd") {
    requireCapability(capabilities.canManageTags, "TAG_ADMIN_FORBIDDEN");
    ensureUniqueTagLabel(contenu, saisie.label);
    contenu.tags.push({
      id: slugifyTag(saisie.label),
      label: saisie.label,
      active: true,
      sortOrder: contenu.tags.length,
    });
    return { payload: contenu };
  }

  if (saisie.action === "tagUpdate") {
    requireCapability(capabilities.canManageTags, "TAG_ADMIN_FORBIDDEN");
    const etiquette = contenu.tags.find((element) => element.id === saisie.tagId);
    if (!etiquette) throw new Error("TAG_NOT_FOUND");
    ensureUniqueTagLabel(contenu, saisie.label, etiquette.id);
    etiquette.label = saisie.label;
    etiquette.active = saisie.active;
    return { payload: contenu };
  }

  if (saisie.action === "tagMove") {
    requireCapability(capabilities.canManageTags, "TAG_ADMIN_FORBIDDEN");
    const ordered = [...contenu.tags].sort((a, b) => a.sortOrder - b.sortOrder);
    const indice = ordered.findIndex((etiquette) => etiquette.id === saisie.tagId);
    if (indice < 0) throw new Error("TAG_NOT_FOUND");
    const cible = saisie.direction === "up" ? indice - 1 : indice + 1;
    if (cible < 0 || cible >= ordered.length) return { payload: contenu };
    [ordered[indice], ordered[cible]] = [ordered[cible], ordered[indice]];
    ordered.forEach((etiquette, position) => {
      const courant = contenu.tags.find((candidat) => candidat.id === etiquette.id);
      if (courant) courant.sortOrder = position;
    });
    return { payload: contenu };
  }

  const entree = findEntry(contenu, saisie.entryId);

  if (saisie.action === "qualifyDraft") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entree);
    ensureTagIds(contenu, saisie.tagIds);
    entree.structuredDescription = saisie.description || null;
    entree.nextAction = saisie.nextAction || null;
    entree.tagIds = [...saisie.tagIds];
    history(
      entree,
      auteur,
      "QUALIFICATION_SAVED",
      "Qualification enregistrée sans sortir de la boîte.",
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "qualifyAssign") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entree);
    ensureTagIds(contenu, saisie.tagIds);
    entree.structuredDescription = saisie.description;
    entree.nextAction = saisie.nextAction;
    entree.tagIds = [...saisie.tagIds];
    entree.status = "ASSIGNED";
    entree.assigneeName = saisie.assigneeName;
    entree.dueDate = saisie.dueDate;
    entree.snoozedUntilDate = null;
    history(
      entree,
      auteur,
      "QUALIFICATION_SAVED",
      "Entrée qualifiée sans ressaisie du texte d'origine.",
      maintenant,
    );
    history(
      entree,
      auteur,
      "ASSIGNED",
      `Affectée à ${saisie.assigneeName}, échéance ${saisie.dueDate}.`,
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "qualifyActions") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entree);
    ensureTagIds(contenu, saisie.tagIds);

    entree.structuredDescription = saisie.description;
    entree.nextAction = null;
    entree.tagIds = [...saisie.tagIds];
    entree.status = "DONE";
    entree.result = `${saisie.actions.length} action${saisie.actions.length > 1 ? "s" : ""} suivante${saisie.actions.length > 1 ? "s" : ""} créée${saisie.actions.length > 1 ? "s" : ""}.`;
    entree.completedAt = maintenant;
    entree.snoozedUntilDate = null;

    const createdActions: EntryRecord[] = saisie.actions.map((action) => {
      const child: EntryRecord = {
        id: randomUUID(),
        rawText: action.text,
        structuredDescription: saisie.description,
        nextAction: action.text,
        tagIds: [...saisie.tagIds],
        priority: entree.priority,
        status: "ASSIGNED",
        createdAt: maintenant,
        createdByName: auteur.displayName,
        assigneeName: action.assigneeName,
        dueDate: action.dueDate,
        snoozedUntilDate: null,
        result: null,
        completedAt: null,
        parentEntryId: entree.id,
        clientId: entree.clientId ?? null,
        commercialCaseId: entree.commercialCaseId ?? null,
        derivedEntryIds: [],
        attachments: [],
        history: [],
      };
      history(child, auteur, "CREATED", `Action créée depuis « ${entree.rawText} ».`, maintenant);
      history(
        child,
        auteur,
        "ASSIGNED",
        `Affectée à ${action.assigneeName}, échéance ${action.dueDate}.`,
        maintenant,
      );
      entree.derivedEntryIds.push(child.id);
      history(
        entree,
        auteur,
        "DERIVED_CREATED",
        `Action liée créée : « ${action.text} ».`,
        maintenant,
      );
      return child;
    });

    history(
      entree,
      auteur,
      "COMPLETED",
      `Note validée avec ${createdActions.length} action${createdActions.length > 1 ? "s" : ""} suivante${createdActions.length > 1 ? "s" : ""}.`,
      maintenant,
    );

    contenu.entries.unshift(...createdActions);
    return { payload: contenu, focusEntryId: createdActions[0]?.id ?? entree.id };
  }

  if (saisie.action === "updateAssigned") {
    assertAssignedToActor(entree, auteur);
    ensureTagIds(contenu, saisie.tagIds);
    entree.structuredDescription = saisie.description;
    entree.nextAction = saisie.nextAction;
    entree.priority = saisie.priority;
    entree.tagIds = [...saisie.tagIds];
    history(
      entree,
      auteur,
      "QUALIFICATION_SAVED",
      "Informations de la tâche mises à jour depuis Mes tâches.",
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "assignedActions") {
    assertAssignedToActor(entree, auteur);

    const createdActions: EntryRecord[] = saisie.actions.map((action) => {
      const child: EntryRecord = {
        id: randomUUID(),
        rawText: action.text,
        structuredDescription: entree.structuredDescription,
        nextAction: action.text,
        tagIds: [...entree.tagIds],
        priority: entree.priority,
        status: "ASSIGNED",
        createdAt: maintenant,
        createdByName: auteur.displayName,
        assigneeName: action.assigneeName,
        dueDate: action.dueDate,
        snoozedUntilDate: null,
        result: null,
        completedAt: null,
        parentEntryId: entree.id,
        clientId: entree.clientId ?? null,
        commercialCaseId: entree.commercialCaseId ?? null,
        derivedEntryIds: [],
        attachments: [],
        history: [],
      };

      history(child, auteur, "CREATED", `Action créée depuis « ${entree.rawText} ».`, maintenant);
      history(
        child,
        auteur,
        "ASSIGNED",
        `Affectée à ${action.assigneeName}, échéance ${action.dueDate}.`,
        maintenant,
      );
      entree.derivedEntryIds.push(child.id);
      history(
        entree,
        auteur,
        "DERIVED_CREATED",
        `Action liée créée : « ${action.text} ».`,
        maintenant,
      );
      return child;
    });

    contenu.entries.unshift(...createdActions);
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "qualifyDone") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entree);
    ensureTagIds(contenu, saisie.tagIds);
    entree.tagIds = [...saisie.tagIds];
    entree.status = "DONE";
    entree.result = saisie.result || null;
    entree.completedAt = maintenant;
    entree.snoozedUntilDate = null;
    history(
      entree,
      auteur,
      "COMPLETED",
      saisie.result ? `Traité / terminé : ${saisie.result}` : "Traité / terminé.",
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "snooze") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entree);
    if (saisie.untilDate < parisDateKey(nowDate)) throw new Error("SNOOZE_DATE_IN_PAST");
    entree.snoozedUntilDate = saisie.untilDate;
    history(
      entree,
      auteur,
      "SNOOZED",
      `Voir plus tard jusqu'au ${saisie.untilDate}. Motif : ${saisie.reason}`,
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "postpone") {
    assertAssignedToActor(entree, auteur);
    if (!entree.dueDate || saisie.dueDate <= entree.dueDate) {
      throw new Error("POSTPONE_DATE_NOT_LATER");
    }
    const oldDate = entree.dueDate;
    entree.dueDate = saisie.dueDate;
    history(
      entree,
      auteur,
      "DEADLINE_POSTPONED",
      `Échéance repoussée du ${oldDate} au ${saisie.dueDate}. Motif : ${saisie.reason}`,
      maintenant,
    );
    const recipients = new Set(
      (auteur.notificationRecipients ?? []).filter(
        (nom) => normalizePersonName(nom) !== normalizePersonName(auteur.displayName),
      ),
    );
    for (const recipientName of recipients) {
      notify(
        contenu,
        entree.id,
        recipientName,
        `${auteur.displayName} a repoussé « ${entree.rawText} » au ${saisie.dueDate}. Motif : ${saisie.reason}`,
        maintenant,
      );
    }
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "reassign") {
    assertAssignedToActor(entree, auteur);
    const oldAssignee = entree.assigneeName ?? auteur.displayName;
    entree.assigneeName = saisie.assigneeName;
    history(
      entree,
      auteur,
      "REASSIGNED",
      `Réaffectée de ${oldAssignee} à ${saisie.assigneeName}. Motif : ${saisie.reason}`,
      maintenant,
    );
    notify(
      contenu,
      entree.id,
      saisie.assigneeName,
      `${auteur.displayName} vous a réaffecté « ${entree.rawText} ». Échéance inchangée : ${entree.dueDate ?? "sans date"}.`,
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "complete") {
    assertAssignedToActor(entree, auteur);
    entree.status = "DONE";
    entree.result = saisie.result || null;
    entree.completedAt = maintenant;
    history(
      entree,
      auteur,
      "COMPLETED",
      saisie.result ? `Terminé : ${saisie.result}` : "Terminé.",
      maintenant,
    );
    return { payload: contenu, focusEntryId: entree.id };
  }

  if (saisie.action === "derive") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entree);
    const derived: EntryRecord = {
      id: randomUUID(),
      rawText: saisie.rawText,
      structuredDescription: null,
      nextAction: null,
      tagIds: [...entree.tagIds],
      priority: entree.priority,
      status: "TO_QUALIFY",
      createdAt: maintenant,
      createdByName: auteur.displayName,
      assigneeName: null,
      dueDate: null,
      snoozedUntilDate: null,
      result: null,
      completedAt: null,
      parentEntryId: entree.id,
      clientId: entree.clientId ?? null,
      commercialCaseId: entree.commercialCaseId ?? null,
      derivedEntryIds: [],
      attachments: [],
      history: [],
    };
    history(derived, auteur, "CREATED", `Entrée dérivée de « ${entree.rawText} ».`, maintenant);
    history(
      entree,
      auteur,
      "DERIVED_CREATED",
      `Entrée liée créée : « ${saisie.rawText} ».`,
      maintenant,
    );
    entree.derivedEntryIds.push(derived.id);
    contenu.entries.unshift(derived);
    return { payload: contenu, focusEntryId: derived.id };
  }

  throw new Error("ENTRY_MUTATION_UNSUPPORTED");
}

export function listSuggestedAssignees(contenu: EntriesPayload, auteur: EntriesActor): string[] {
  const noms = new Set<string>([...(auteur.assignmentCandidates ?? []), auteur.displayName]);
  for (const entree of contenu.entries) {
    if (entree.assigneeName) noms.add(entree.assigneeName);
    noms.add(entree.createdByName);
  }
  return [...noms].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr-FR"));
}
