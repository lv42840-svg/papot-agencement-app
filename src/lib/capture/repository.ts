import "server-only";

import { db } from "@/lib/db/pool";
import type { CaptureCreateInput } from "@/lib/capture/schema";
import { createCaptureWithClient } from "@/lib/capture/write";

export type CaptureListItem = {
  id: string;
  title: string;
  priority: "NORMAL" | "URGENT";
  dueAt: string | null;
  createdAt: string;
  creatorName: string;
  responsibleName: string;
};

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
