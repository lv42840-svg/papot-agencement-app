import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CaptureCreateInput } from "./schema";

export async function createCaptureWithClient(
  input: CaptureCreateInput,
  creatorUserId: string,
  client: PoolClient,
) {
  const [responsible, creator] = await Promise.all([
    client.query("SELECT 1 FROM app_user WHERE id = $1 AND is_active = true", [
      input.responsibleUserId,
    ]),
    client.query<{ display_name: string }>(
      "SELECT display_name FROM app_user WHERE id = $1 AND is_active = true",
      [creatorUserId],
    ),
  ]);
  if (!responsible.rowCount) throw new Error("INVALID_RESPONSIBLE");
  if (!creator.rows[0]) throw new Error("INVALID_CREATOR");

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

  await client.query(
    `INSERT INTO capture_entry_history(
       id, capture_entry_id, event_type, actor_user_id, actor_name, summary, occurred_at
     ) VALUES ($1, $2, 'CREATED', $3, $4, $5, now())`,
    [
      randomUUID(),
      id,
      creatorUserId,
      creator.rows[0].display_name,
      "Entrée créée dans À qualifier.",
    ],
  );

  return { id, created: true };
}
