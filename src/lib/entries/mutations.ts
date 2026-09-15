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
    action: z.literal("updateAssigned"),
    entryId: z.string().uuid(),
    description: z.string().trim().min(1).max(4000),
    nextAction: z.string().trim().min(1).max(2000),
    priority: z.enum(["NORMAL", "URGENT"]),
    tagIds: tagIdsSchema,
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
};
export type EntriesCapabilities = { canQualify: boolean; canManageTags: boolean };
export type EntriesMutationResult = { payload: EntriesPayload; focusEntryId?: string };

export function entriesCapabilities(actor: EntriesActor): EntriesCapabilities {
  return {
    canQualify: actor.canQualify === true,
    canManageTags: actor.canManageTags === true,
  };
}

function requireCapability(value: boolean, code: string): void {
  if (!value) throw new Error(code);
}

function findEntry(payload: EntriesPayload, entryId: string): EntryRecord {
  const entry = payload.entries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new Error("ENTRY_NOT_FOUND");
  return entry;
}

function assertToQualify(entry: EntryRecord): void {
  if (entry.status !== "TO_QUALIFY") throw new Error("ENTRY_NOT_TO_QUALIFY");
}

function assertAssignedToActor(entry: EntryRecord, actor: EntriesActor): void {
  if (entry.status !== "ASSIGNED") throw new Error("ENTRY_NOT_ASSIGNED");
  if (
    !entry.assigneeName ||
    normalizePersonName(entry.assigneeName) !== normalizePersonName(actor.displayName)
  ) {
    throw new Error("ENTRY_NOT_ASSIGNED_TO_ACTOR");
  }
}

function ensureTagIds(payload: EntriesPayload, tagIds: string[]): void {
  const known = new Set(payload.tags.map((tag) => tag.id));
  if (tagIds.some((tagId) => !known.has(tagId))) throw new Error("ENTRY_TAG_UNKNOWN");
}

function history(
  entry: EntryRecord,
  actor: EntriesActor,
  type: EntryRecord["history"][number]["type"],
  summary: string,
  now: string,
): void {
  entry.history.push({ id: randomUUID(), type, at: now, actorName: actor.displayName, summary });
}

function notify(
  payload: EntriesPayload,
  entryId: string,
  recipientName: string,
  message: string,
  now: string,
): void {
  payload.notifications.push({
    id: randomUUID(),
    entryId,
    recipientName,
    createdAt: now,
    message,
    readAt: null,
  });
}

function ensureUniqueTagLabel(payload: EntriesPayload, label: string, exceptId?: string): void {
  const key = normalizePersonName(label);
  if (payload.tags.some((tag) => tag.id !== exceptId && normalizePersonName(tag.label) === key)) {
    throw new Error("TAG_LABEL_EXISTS");
  }
}

function slugifyTag(label: string): string {
  const base = normalizePersonName(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "tag"}-${randomUUID().slice(0, 8)}`;
}

export function registerEntryAttachments(
  source: EntriesPayload,
  entryId: string,
  attachments: EntryAttachment[],
  actor: EntriesActor,
  nowDate: Date = new Date(),
): EntriesMutationResult {
  const payload = structuredClone(source);
  const entry = findEntry(payload, entryId);
  const knownIds = new Set(entry.attachments.map((item) => item.id));
  const knownPaths = new Set(entry.attachments.map((item) => item.storagePath));
  if (attachments.some((item) => knownIds.has(item.id) || knownPaths.has(item.storagePath))) {
    throw new Error("ENTRY_ATTACHMENT_DUPLICATE");
  }
  entry.attachments.push(...attachments);
  if (attachments.length > 0) {
    const names = attachments
      .slice(0, 3)
      .map((item) => item.fileName)
      .join(", ");
    const suffix = attachments.length > 3 ? ` +${attachments.length - 3}` : "";
    history(
      entry,
      actor,
      "ATTACHMENTS_ADDED",
      `${attachments.length} pièce${attachments.length > 1 ? "s" : ""} jointe${attachments.length > 1 ? "s" : ""} ajoutée${attachments.length > 1 ? "s" : ""} : ${names}${suffix}.`,
      nowDate.toISOString(),
    );
  }
  return { payload, focusEntryId: entry.id };
}

export function applyEntriesMutation(
  source: EntriesPayload,
  input: EntriesMutation,
  actor: EntriesActor,
  nowDate: Date = new Date(),
): EntriesMutationResult {
  const payload = structuredClone(source);
  const capabilities = entriesCapabilities(actor);
  const now = nowDate.toISOString();

  if (input.action === "create") {
    ensureTagIds(payload, input.tagIds);
    const entry: EntryRecord = {
      id: input.entryId ?? randomUUID(),
      rawText: input.rawText,
      structuredDescription: null,
      nextAction: null,
      tagIds: [...input.tagIds],
      priority: input.priority,
      status: "TO_QUALIFY",
      createdAt: now,
      createdByName: actor.displayName,
      assigneeName: null,
      dueDate: null,
      snoozedUntilDate: null,
      result: null,
      completedAt: null,
      parentEntryId: null,
      derivedEntryIds: [],
      attachments: [],
      history: [],
    };
    history(entry, actor, "CREATED", "Entrée créée dans À qualifier.", now);
    payload.entries.unshift(entry);
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "notificationRead") {
    const notification = payload.notifications.find((item) => item.id === input.notificationId);
    if (!notification) throw new Error("NOTIFICATION_NOT_FOUND");
    if (
      normalizePersonName(notification.recipientName) !== normalizePersonName(actor.displayName)
    ) {
      throw new Error("NOTIFICATION_FORBIDDEN");
    }
    notification.readAt = now;
    return { payload, focusEntryId: notification.entryId };
  }

  if (input.action === "tagAdd") {
    requireCapability(capabilities.canManageTags, "TAG_ADMIN_FORBIDDEN");
    ensureUniqueTagLabel(payload, input.label);
    payload.tags.push({
      id: slugifyTag(input.label),
      label: input.label,
      active: true,
      sortOrder: payload.tags.length,
    });
    return { payload };
  }

  if (input.action === "tagUpdate") {
    requireCapability(capabilities.canManageTags, "TAG_ADMIN_FORBIDDEN");
    const tag = payload.tags.find((item) => item.id === input.tagId);
    if (!tag) throw new Error("TAG_NOT_FOUND");
    ensureUniqueTagLabel(payload, input.label, tag.id);
    tag.label = input.label;
    tag.active = input.active;
    return { payload };
  }

  if (input.action === "tagMove") {
    requireCapability(capabilities.canManageTags, "TAG_ADMIN_FORBIDDEN");
    const ordered = [...payload.tags].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((tag) => tag.id === input.tagId);
    if (index < 0) throw new Error("TAG_NOT_FOUND");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return { payload };
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    ordered.forEach((tag, position) => {
      const current = payload.tags.find((candidate) => candidate.id === tag.id);
      if (current) current.sortOrder = position;
    });
    return { payload };
  }

  const entry = findEntry(payload, input.entryId);

  if (input.action === "qualifyDraft") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entry);
    ensureTagIds(payload, input.tagIds);
    entry.structuredDescription = input.description || null;
    entry.nextAction = input.nextAction || null;
    entry.tagIds = [...input.tagIds];
    history(
      entry,
      actor,
      "QUALIFICATION_SAVED",
      "Qualification enregistrée sans sortir de la boîte.",
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "qualifyAssign") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entry);
    ensureTagIds(payload, input.tagIds);
    entry.structuredDescription = input.description;
    entry.nextAction = input.nextAction;
    entry.tagIds = [...input.tagIds];
    entry.status = "ASSIGNED";
    entry.assigneeName = input.assigneeName;
    entry.dueDate = input.dueDate;
    entry.snoozedUntilDate = null;
    history(
      entry,
      actor,
      "QUALIFICATION_SAVED",
      "Entrée qualifiée sans ressaisie du texte d'origine.",
      now,
    );
    history(
      entry,
      actor,
      "ASSIGNED",
      `Affectée à ${input.assigneeName}, échéance ${input.dueDate}.`,
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "updateAssigned") {
    assertAssignedToActor(entry, actor);
    ensureTagIds(payload, input.tagIds);
    entry.structuredDescription = input.description;
    entry.nextAction = input.nextAction;
    entry.priority = input.priority;
    entry.tagIds = [...input.tagIds];
    history(
      entry,
      actor,
      "QUALIFICATION_SAVED",
      "Informations de la tâche mises à jour depuis Mes tâches.",
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "qualifyDone") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entry);
    ensureTagIds(payload, input.tagIds);
    entry.tagIds = [...input.tagIds];
    entry.status = "DONE";
    entry.result = input.result || null;
    entry.completedAt = now;
    entry.snoozedUntilDate = null;
    history(
      entry,
      actor,
      "COMPLETED",
      input.result ? `Traité / terminé : ${input.result}` : "Traité / terminé.",
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "snooze") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entry);
    if (input.untilDate < parisDateKey(nowDate)) throw new Error("SNOOZE_DATE_IN_PAST");
    entry.snoozedUntilDate = input.untilDate;
    history(
      entry,
      actor,
      "SNOOZED",
      `Voir plus tard jusqu'au ${input.untilDate}. Motif : ${input.reason}`,
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "postpone") {
    assertAssignedToActor(entry, actor);
    if (!entry.dueDate || input.dueDate <= entry.dueDate) {
      throw new Error("POSTPONE_DATE_NOT_LATER");
    }
    const oldDate = entry.dueDate;
    entry.dueDate = input.dueDate;
    history(
      entry,
      actor,
      "DEADLINE_POSTPONED",
      `Échéance repoussée du ${oldDate} au ${input.dueDate}. Motif : ${input.reason}`,
      now,
    );
    notify(
      payload,
      entry.id,
      "Nadia",
      `${actor.displayName} a repoussé « ${entry.rawText} » au ${input.dueDate}. Motif : ${input.reason}`,
      now,
    );
    notify(
      payload,
      entry.id,
      "Lucien",
      `${actor.displayName} a repoussé « ${entry.rawText} » au ${input.dueDate}. Motif : ${input.reason}`,
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "reassign") {
    assertAssignedToActor(entry, actor);
    const oldAssignee = entry.assigneeName ?? actor.displayName;
    entry.assigneeName = input.assigneeName;
    history(
      entry,
      actor,
      "REASSIGNED",
      `Réaffectée de ${oldAssignee} à ${input.assigneeName}. Motif : ${input.reason}`,
      now,
    );
    notify(
      payload,
      entry.id,
      input.assigneeName,
      `${actor.displayName} vous a réaffecté « ${entry.rawText} ». Échéance inchangée : ${entry.dueDate ?? "sans date"}.`,
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "complete") {
    assertAssignedToActor(entry, actor);
    entry.status = "DONE";
    entry.result = input.result || null;
    entry.completedAt = now;
    history(
      entry,
      actor,
      "COMPLETED",
      input.result ? `Terminé : ${input.result}` : "Terminé.",
      now,
    );
    return { payload, focusEntryId: entry.id };
  }

  if (input.action === "derive") {
    requireCapability(capabilities.canQualify, "QUALIFICATION_FORBIDDEN");
    assertToQualify(entry);
    const derived: EntryRecord = {
      id: randomUUID(),
      rawText: input.rawText,
      structuredDescription: null,
      nextAction: null,
      tagIds: [...entry.tagIds],
      priority: entry.priority,
      status: "TO_QUALIFY",
      createdAt: now,
      createdByName: actor.displayName,
      assigneeName: null,
      dueDate: null,
      snoozedUntilDate: null,
      result: null,
      completedAt: null,
      parentEntryId: entry.id,
      derivedEntryIds: [],
      attachments: [],
      history: [],
    };
    history(derived, actor, "CREATED", `Entrée dérivée de « ${entry.rawText} ».`, now);
    history(entry, actor, "DERIVED_CREATED", `Entrée liée créée : « ${input.rawText} ».`, now);
    entry.derivedEntryIds.push(derived.id);
    payload.entries.unshift(derived);
    return { payload, focusEntryId: derived.id };
  }

  throw new Error("ENTRY_MUTATION_UNSUPPORTED");
}

export function listSuggestedAssignees(payload: EntriesPayload, actor: EntriesActor): string[] {
  const names = new Set<string>(["Nadia", "Lucien", actor.displayName]);
  for (const entry of payload.entries) {
    if (entry.assigneeName) names.add(entry.assigneeName);
    names.add(entry.createdByName);
  }
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr-FR"));
}
