import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CaptureCreateInput } from "./schema";

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
