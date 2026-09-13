import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db/pool";
import {
  normalizePersonName,
  type EntriesPayload,
  type EntriesTag,
  type EntryAttachment,
  type EntryNotification,
  type EntryRecord,
} from "./domain";
import {
  applyEntriesMutation,
  registerEntryAttachments,
  type EntriesActor,
  type EntriesMutation,
  type EntriesMutationResult,
} from "./mutations";

const ENTRIES_ADVISORY_LOCK = 684220260913;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UserRow = { id: string; display_name: string; is_active: boolean };
type TagRow = { id: string; label: string; is_active: boolean; sort_order: number };
type EntryRow = {
  id: string;
  title: string;
  structured_description: string | null;
  next_action: string | null;
  priority: "NORMAL" | "URGENT";
  status: "TO_QUALIFY" | "ASSIGNED" | "DONE" | "QUALIFIED";
  created_at: Date;
  created_by_name: string;
  assignee_name: string | null;
  due_date: string | null;
  snoozed_until_date: string | null;
  result: string | null;
  completed_at: Date | null;
  parent_entry_id: string | null;
};
type EntryTagRow = { capture_entry_id: string; tag_id: string };
type HistoryRow = {
  id: string;
  capture_entry_id: string;
  event_type: EntryRecord["history"][number]["type"];
  actor_name: string;
  summary: string;
  occurred_at: Date;
};
type AttachmentRow = {
  id: string;
  capture_entry_id: string;
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  sha256: string;
  nextcloud_path: string;
  created_at: Date;
  uploaded_by_name: string;
};
type NotificationRow = {
  id: string;
  capture_entry_id: string;
  recipient_name: string;
  created_at: Date;
  message: string;
  read_at: Date | null;
};

function isSame(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dueDateValue(value: string | null): Date | null {
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}

function slugBase(value: string): string {
  return normalizePersonName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tag";
}

async function listUsers(client: PoolClient): Promise<UserRow[]> {
  const result = await client.query<UserRow>(
    "SELECT id, display_name, is_active FROM app_user ORDER BY display_name, id",
  );
  return result.rows;
}

function resolveUserId(users: UserRow[], displayName: string): string {
  const key = normalizePersonName(displayName);
  const matches = users.filter(
    (user) => user.is_active && normalizePersonName(user.display_name) === key,
  );
  if (matches.length === 0) throw new Error("ENTRY_ASSIGNEE_NOT_FOUND");
  if (matches.length > 1) throw new Error("ENTRY_ASSIGNEE_AMBIGUOUS");
  return matches[0]!.id;
}

function resolveOptionalUserId(users: UserRow[], displayName: string): string | null {
  const key = normalizePersonName(displayName);
  const matches = users.filter(
    (user) => user.is_active && normalizePersonName(user.display_name) === key,
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

async function loadEntriesPayloadWithClient(client: PoolClient): Promise<EntriesPayload> {
  const [tagsResult, entriesResult, entryTagsResult, historyResult, attachmentsResult, notificationsResult] =
    await Promise.all([
      client.query<TagRow>(
        `SELECT id::text AS id, label, is_active, sort_order
         FROM capture_tag
         ORDER BY sort_order, label, id`,
      ),
      client.query<EntryRow>(
        `SELECT e.id::text AS id,
                e.title,
                e.structured_description,
                e.next_action,
                e.priority,
                e.status,
                e.created_at,
                creator.display_name AS created_by_name,
                assignee.display_name AS assignee_name,
                CASE
                  WHEN e.due_at IS NULL THEN NULL
                  ELSE to_char(e.due_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
                END AS due_date,
                e.snoozed_until_date::text AS snoozed_until_date,
                e.result,
                e.completed_at,
                e.parent_entry_id::text AS parent_entry_id
         FROM capture_entry e
         JOIN app_user creator ON creator.id = e.created_by_user_id
         LEFT JOIN app_user assignee ON assignee.id = e.assignee_user_id
         ORDER BY e.created_at DESC, e.id DESC`,
      ),
      client.query<EntryTagRow>(
        `SELECT capture_entry_id::text AS capture_entry_id, tag_id::text AS tag_id
         FROM capture_entry_tag
         ORDER BY capture_entry_id, tag_id`,
      ),
      client.query<HistoryRow>(
        `SELECT id::text AS id,
                capture_entry_id::text AS capture_entry_id,
                event_type,
                actor_name,
                summary,
                occurred_at
         FROM capture_entry_history
         ORDER BY occurred_at, id`,
      ),
      client.query<AttachmentRow>(
        `SELECT a.id::text AS id,
                a.capture_entry_id::text AS capture_entry_id,
                a.file_name,
                a.content_type,
                a.size_bytes,
                a.sha256,
                a.nextcloud_path,
                a.created_at,
                COALESCE(uploader.display_name, creator.display_name) AS uploaded_by_name
         FROM capture_attachment a
         JOIN capture_entry e ON e.id = a.capture_entry_id
         JOIN app_user creator ON creator.id = e.created_by_user_id
         LEFT JOIN app_user uploader ON uploader.id = a.uploaded_by_user_id
         ORDER BY a.created_at, a.id`,
      ),
      client.query<NotificationRow>(
        `SELECT id::text AS id,
                capture_entry_id::text AS capture_entry_id,
                recipient_name,
                created_at,
                message,
                read_at
         FROM capture_notification
         ORDER BY created_at, id`,
      ),
    ]);

  const tagIdsByEntry = new Map<string, string[]>();
  for (const row of entryTagsResult.rows) {
    const values = tagIdsByEntry.get(row.capture_entry_id) ?? [];
    values.push(row.tag_id);
    tagIdsByEntry.set(row.capture_entry_id, values);
  }

  const historyByEntry = new Map<string, EntryRecord["history"]>();
  for (const row of historyResult.rows) {
    const values = historyByEntry.get(row.capture_entry_id) ?? [];
    values.push({
      id: row.id,
      type: row.event_type,
      at: row.occurred_at.toISOString(),
      actorName: row.actor_name,
      summary: row.summary,
    });
    historyByEntry.set(row.capture_entry_id, values);
  }

  const attachmentsByEntry = new Map<string, EntryAttachment[]>();
  for (const row of attachmentsResult.rows) {
    const values = attachmentsByEntry.get(row.capture_entry_id) ?? [];
    values.push({
      id: row.id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
      storagePath: row.nextcloud_path,
      uploadedAt: row.created_at.toISOString(),
      uploadedByName: row.uploaded_by_name,
    });
    attachmentsByEntry.set(row.capture_entry_id, values);
  }

  const derivedIdsByParent = new Map<string, string[]>();
  for (const row of entriesResult.rows) {
    if (!row.parent_entry_id) continue;
    const values = derivedIdsByParent.get(row.parent_entry_id) ?? [];
    values.push(row.id);
    derivedIdsByParent.set(row.parent_entry_id, values);
  }

  const tags: EntriesTag[] = tagsResult.rows.map((row) => ({
    id: row.id,
    label: row.label,
    active: row.is_active,
    sortOrder: row.sort_order,
  }));

  const entries: EntryRecord[] = entriesResult.rows.map((row) => ({
    id: row.id,
    rawText: row.title,
    structuredDescription: row.structured_description,
    nextAction: row.next_action,
    tagIds: tagIdsByEntry.get(row.id) ?? [],
    priority: row.priority,
    status: row.status === "QUALIFIED" ? "ASSIGNED" : row.status,
    createdAt: row.created_at.toISOString(),
    createdByName: row.created_by_name,
    assigneeName: row.assignee_name,
    dueDate: row.due_date,
    snoozedUntilDate: row.snoozed_until_date,
    result: row.result,
    completedAt: row.completed_at?.toISOString() ?? null,
    parentEntryId: row.parent_entry_id,
    derivedEntryIds: derivedIdsByParent.get(row.id) ?? [],
    attachments: attachmentsByEntry.get(row.id) ?? [],
    history: historyByEntry.get(row.id) ?? [],
  }));

  const notifications: EntryNotification[] = notificationsResult.rows.map((row) => ({
    id: row.id,
    entryId: row.capture_entry_id,
    recipientName: row.recipient_name,
    createdAt: row.created_at.toISOString(),
    message: row.message,
    readAt: row.read_at?.toISOString() ?? null,
  }));

  return { schemaVersion: 1, tags, entries, notifications };
}

async function persistTags(
  client: PoolClient,
  before: EntriesPayload,
  after: EntriesPayload,
): Promise<void> {
  const beforeById = new Map(before.tags.map((tag) => [tag.id, tag]));

  for (const tag of after.tags) {
    const previous = beforeById.get(tag.id);
    if (previous && isSame(previous, tag)) continue;

    if (previous) {
      await client.query(
        `UPDATE capture_tag
         SET label = $2, is_active = $3, sort_order = $4, updated_at = now()
         WHERE id = $1::uuid`,
        [tag.id, tag.label, tag.active, tag.sortOrder],
      );
      continue;
    }

    const id = UUID_PATTERN.test(tag.id) ? tag.id : randomUUID();
    const slug = `${slugBase(tag.label)}-${id.slice(0, 8)}`;
    await client.query(
      `INSERT INTO capture_tag(id, label, slug, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, tag.label, slug, tag.active, tag.sortOrder],
    );
  }
}

async function persistEntry(
  client: PoolClient,
  entry: EntryRecord,
  previous: EntryRecord | undefined,
  actor: EntriesActor,
  users: UserRow[],
): Promise<void> {
  const assigneeUserId = entry.assigneeName ? resolveUserId(users, entry.assigneeName) : null;
  const dueChanged = previous ? previous.dueDate !== entry.dueDate : true;
  const dueAt = dueDateValue(entry.dueDate);

  if (previous) {
    await client.query(
      `UPDATE capture_entry
       SET title = $2,
           structured_description = $3,
           next_action = $4,
           priority = $5,
           status = $6,
           assignee_user_id = $7,
           due_at = CASE WHEN $8::boolean THEN $9::timestamptz ELSE due_at END,
           snoozed_until_date = $10::date,
           result = $11,
           completed_at = $12::timestamptz,
           parent_entry_id = $13::uuid,
           updated_at = now()
       WHERE id = $1::uuid`,
      [
        entry.id,
        entry.rawText,
        entry.structuredDescription,
        entry.nextAction,
        entry.priority,
        entry.status,
        assigneeUserId,
        dueChanged,
        dueAt,
        entry.snoozedUntilDate,
        entry.result,
        entry.completedAt ? new Date(entry.completedAt) : null,
        entry.parentEntryId,
      ],
    );
  } else {
    const responsibleUserId = assigneeUserId ?? actor.userId;
    await client.query(
      `INSERT INTO capture_entry(
         id, client_request_id, capture_type, title, responsible_user_id,
         created_by_user_id, priority, due_at, status, structured_description,
         next_action, assignee_user_id, snoozed_until_date, result, completed_at,
         parent_entry_id, created_at, updated_at
       ) VALUES (
         $1, $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12::date, $13, $14::timestamptz, $15::uuid, $16::timestamptz, now()
       )`,
      [
        entry.id,
        entry.parentEntryId ? "DERIVED_TASK" : "COMMERCIAL_LEAD",
        entry.rawText,
        responsibleUserId,
        actor.userId,
        entry.priority,
        dueAt,
        entry.status,
        entry.structuredDescription,
        entry.nextAction,
        assigneeUserId,
        entry.snoozedUntilDate,
        entry.result,
        entry.completedAt ? new Date(entry.completedAt) : null,
        entry.parentEntryId,
        new Date(entry.createdAt),
      ],
    );
  }

  await client.query("DELETE FROM capture_entry_tag WHERE capture_entry_id = $1::uuid", [entry.id]);
  for (const tagId of entry.tagIds) {
    if (!UUID_PATTERN.test(tagId)) throw new Error("ENTRY_TAG_ID_INVALID");
    await client.query(
      `INSERT INTO capture_entry_tag(capture_entry_id, tag_id)
       VALUES ($1::uuid, $2::uuid)
       ON CONFLICT DO NOTHING`,
      [entry.id, tagId],
    );
  }

  const previousHistoryIds = new Set(previous?.history.map((event) => event.id) ?? []);
  for (const event of entry.history) {
    if (previousHistoryIds.has(event.id)) continue;
    const actorUserId =
      normalizePersonName(event.actorName) === normalizePersonName(actor.displayName)
        ? actor.userId
        : resolveOptionalUserId(users, event.actorName);
    await client.query(
      `INSERT INTO capture_entry_history(
         id, capture_entry_id, event_type, actor_user_id, actor_name, summary, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        entry.id,
        event.type,
        actorUserId,
        event.actorName,
        event.summary,
        new Date(event.at),
      ],
    );
  }

  const previousAttachmentIds = new Set(previous?.attachments.map((attachment) => attachment.id) ?? []);
  for (const attachment of entry.attachments) {
    if (previousAttachmentIds.has(attachment.id)) continue;
    const uploadedByUserId =
      normalizePersonName(attachment.uploadedByName) === normalizePersonName(actor.displayName)
        ? actor.userId
        : resolveOptionalUserId(users, attachment.uploadedByName);
    await client.query(
      `INSERT INTO capture_attachment(
         id, capture_entry_id, file_name, content_type, size_bytes, sha256,
         nextcloud_path, created_at, uploaded_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        attachment.id,
        entry.id,
        attachment.fileName,
        attachment.contentType,
        attachment.sizeBytes,
        attachment.sha256,
        attachment.storagePath,
        new Date(attachment.uploadedAt),
        uploadedByUserId,
      ],
    );
  }
}

async function persistNotifications(
  client: PoolClient,
  before: EntriesPayload,
  after: EntriesPayload,
  users: UserRow[],
): Promise<void> {
  const beforeById = new Map(before.notifications.map((notification) => [notification.id, notification]));

  for (const notification of after.notifications) {
    const previous = beforeById.get(notification.id);
    if (!previous) {
      await client.query(
        `INSERT INTO capture_notification(
           id, capture_entry_id, recipient_user_id, recipient_name, message, created_at, read_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          notification.id,
          notification.entryId,
          resolveOptionalUserId(users, notification.recipientName),
          notification.recipientName,
          notification.message,
          new Date(notification.createdAt),
          notification.readAt ? new Date(notification.readAt) : null,
        ],
      );
      continue;
    }

    if (previous.readAt !== notification.readAt) {
      await client.query(
        "UPDATE capture_notification SET read_at = $2::timestamptz WHERE id = $1::uuid",
        [notification.id, notification.readAt ? new Date(notification.readAt) : null],
      );
    }
  }
}

async function persistPayloadDiff(
  client: PoolClient,
  before: EntriesPayload,
  after: EntriesPayload,
  actor: EntriesActor,
): Promise<void> {
  const users = await listUsers(client);
  await persistTags(client, before, after);

  const beforeEntries = new Map(before.entries.map((entry) => [entry.id, entry]));
  for (const entry of after.entries) {
    const previous = beforeEntries.get(entry.id);
    if (previous && isSame(previous, entry)) continue;
    await persistEntry(client, entry, previous, actor, users);
  }

  await persistNotifications(client, before, after, users);
}

async function withEntriesTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [ENTRIES_ADVISORY_LOCK]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadEntriesPayloadFromDatabase(): Promise<EntriesPayload> {
  const client = await db.connect();
  try {
    return await loadEntriesPayloadWithClient(client);
  } finally {
    client.release();
  }
}

export async function applyEntriesMutationInDatabase(
  input: EntriesMutation,
  actor: EntriesActor,
): Promise<EntriesMutationResult> {
  return withEntriesTransaction(async (client) => {
    const before = await loadEntriesPayloadWithClient(client);
    const mutation = applyEntriesMutation(before, input, actor);
    await persistPayloadDiff(client, before, mutation.payload, actor);
    const payload = await loadEntriesPayloadWithClient(client);
    return { payload, focusEntryId: mutation.focusEntryId };
  });
}

export async function createEntryWithAttachmentsInDatabase(
  input: {
    entryId: string;
    rawText: string;
    priority: "NORMAL" | "URGENT";
    tagIds: string[];
    attachments: EntryAttachment[];
  },
  actor: EntriesActor,
): Promise<EntriesMutationResult> {
  return withEntriesTransaction(async (client) => {
    const before = await loadEntriesPayloadWithClient(client);
    let mutation = applyEntriesMutation(
      before,
      {
        action: "create",
        entryId: input.entryId,
        rawText: input.rawText,
        priority: input.priority,
        tagIds: input.tagIds,
      },
      actor,
    );
    if (input.attachments.length > 0) {
      mutation = registerEntryAttachments(
        mutation.payload,
        input.entryId,
        input.attachments,
        actor,
      );
    }
    await persistPayloadDiff(client, before, mutation.payload, actor);
    const payload = await loadEntriesPayloadWithClient(client);
    return { payload, focusEntryId: input.entryId };
  });
}

export async function registerEntryAttachmentsInDatabase(
  entryId: string,
  attachments: EntryAttachment[],
  actor: EntriesActor,
): Promise<EntriesMutationResult> {
  return withEntriesTransaction(async (client) => {
    const before = await loadEntriesPayloadWithClient(client);
    const mutation = registerEntryAttachments(before, entryId, attachments, actor);
    await persistPayloadDiff(client, before, mutation.payload, actor);
    const payload = await loadEntriesPayloadWithClient(client);
    return { payload, focusEntryId: entryId };
  });
}

export async function entryExistsInDatabase(entryId: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM capture_entry WHERE id = $1::uuid) AS exists",
    [entryId],
  );
  return result.rows[0]?.exists === true;
}

export async function getEntryAttachmentFromDatabase(
  entryId: string,
  attachmentId: string,
): Promise<EntryAttachment | null> {
  const result = await db.query<AttachmentRow>(
    `SELECT a.id::text AS id,
            a.capture_entry_id::text AS capture_entry_id,
            a.file_name,
            a.content_type,
            a.size_bytes,
            a.sha256,
            a.nextcloud_path,
            a.created_at,
            COALESCE(uploader.display_name, creator.display_name) AS uploaded_by_name
     FROM capture_attachment a
     JOIN capture_entry e ON e.id = a.capture_entry_id
     JOIN app_user creator ON creator.id = e.created_by_user_id
     LEFT JOIN app_user uploader ON uploader.id = a.uploaded_by_user_id
     WHERE a.capture_entry_id = $1::uuid AND a.id = $2::uuid`,
    [entryId, attachmentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storagePath: row.nextcloud_path,
    uploadedAt: row.created_at.toISOString(),
    uploadedByName: row.uploaded_by_name,
  };
}
