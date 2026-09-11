import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db/pool";
import type { CaptureCreateInput } from "@/lib/capture/schema";

export type CaptureListItem = {
  id: string;
  title: string;
  priority: "NORMAL" | "URGENT";
  dueAt: string | null;
  createdAt: string;
  creatorName: string;
  responsibleName: string;
};

export async function createCaptureWithClient(
  input: CaptureCreateInput,
  creatorUserId: string,
  client: PoolClient,
) {
  const responsible = await client.query(
    "SELECT 1 FROM app_user WHERE id = $1 AND is_active = true",
    [input.responsibleUserId],
  );
  if (!responsible.rowCount) throw new Error("INVALID_RESPONSIBLE");

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM capture_entry WHERE client_request_id = $1",
    [input.clientRequestId],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, created: false };
  }

  const id = randomUUID();
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO capture_entry(
       id, client_request_id, capture_type, title, responsible_user_id,
       created_by_user_id, priority, due_at, status
     ) VALUES ($1, $2, 'COMMERCIAL_LEAD', $3, $4, $5, $6, $7, 'TO_QUALIFY')
     ON CONFLICT (client_request_id) DO NOTHING
     RETURNING id`,
    [
      id,
      input.clientRequestId,
      input.title,
      input.responsibleUserId,
      creatorUserId,
      input.priority,
      input.dueAt ? new Date(input.dueAt) : null,
    ],
  );

  if (!inserted.rows[0]) {
    const raced = await client.query<{ id: string }>(
      "SELECT id FROM capture_entry WHERE client_request_id = $1",
      [input.clientRequestId],
    );
    if (!raced.rows[0]) throw new Error("CAPTURE_IDEMPOTENCE_LOOKUP_FAILED");
    return { id: raced.rows[0].id, created: false };
  }

  if (input.tagIds.length) {
    const tags = await client.query<{ id: string }>(
      "SELECT id FROM capture_tag WHERE id = ANY($1::uuid[]) AND is_active = true",
      [input.tagIds],
    );
    if (tags.rowCount !== input.tagIds.length) throw new Error("INVALID_TAG");
    for (const tagId of input.tagIds) {
      await client.query(
        "INSERT INTO capture_entry_tag(capture_entry_id, tag_id) VALUES ($1, $2)",
        [id, tagId],
      );
    }
  }

  return { id, created: true };
}

export async function createCapture(input: CaptureCreateInput, creatorUserId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await createCaptureWithClient(input, creatorUserId, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listToQualify(limit = 30): Promise<CaptureListItem[]> {
  const result = await db.query<{
    id: string;
    title: string;
    priority: "NORMAL" | "URGENT";
    due_at: Date | null;
    created_at: Date;
    creator_name: string;
    responsible_name: string;
  }>(
    `SELECT c.id, c.title, c.priority, c.due_at, c.created_at,
            creator.display_name AS creator_name,
            responsible.display_name AS responsible_name
     FROM capture_entry c
     JOIN app_user creator ON creator.id = c.created_by_user_id
     JOIN app_user responsible ON responsible.id = c.responsible_user_id
     WHERE c.status = 'TO_QUALIFY'
     ORDER BY c.created_at DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    priority: row.priority,
    dueAt: row.due_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    creatorName: row.creator_name,
    responsibleName: row.responsible_name,
  }));
}

export async function listCaptureUsers() {
  const result = await db.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM app_user WHERE is_active = true ORDER BY display_name",
  );
  return result.rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

export async function listActiveTags() {
  const result = await db.query<{ id: string; label: string }>(
    "SELECT id, label FROM capture_tag WHERE is_active = true ORDER BY sort_order, label",
  );
  return result.rows;
}
