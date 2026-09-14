import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { sha256Bytes, type ServerFileStore } from "../server-files/storage";
import { parseEntriesPayload, type EntryAttachment } from "./domain";

const ENTRY_ATTACHMENT_FILES_CUTOVER_DOMAIN = "entry_attachment_files";
const ENTRY_ATTACHMENT_FILES_CUTOVER_SOURCE = "nextcloud:documents/entries+captures";
const ENTRY_ATTACHMENT_FILES_CUTOVER_LOCK_ID = 7_332_170_416_238_509;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

type AttachmentManifestItem = {
  entryId: string;
  attachment: EntryAttachment;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type LegacyEntryAttachmentReader = (attachment: EntryAttachment) => Promise<Buffer>;

async function findCutoverMarker(queryable: Queryable): Promise<CutoverMarkerRow | null> {
  const result = await queryable.query<CutoverMarkerRow>(
    `
      SELECT source_hash, record_count
      FROM papot_domain_cutovers
      WHERE domain = $1
    `,
    [ENTRY_ATTACHMENT_FILES_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

function attachmentManifest(payload: ReturnType<typeof parseEntriesPayload>): AttachmentManifestItem[] {
  return payload.entries
    .flatMap((entry) =>
      entry.attachments.map((attachment) => ({
        entryId: entry.id,
        attachment,
      })),
    )
    .sort((left, right) => {
      const entryOrder = left.entryId.localeCompare(right.entryId);
      if (entryOrder !== 0) return entryOrder;
      return left.attachment.id.localeCompare(right.attachment.id);
    });
}

export function entryAttachmentManifestHash(
  manifest: ReadonlyArray<AttachmentManifestItem>,
): string {
  const canonical = manifest.map(({ entryId, attachment }) => ({
    entryId,
    id: attachment.id,
    storagePath: attachment.storagePath,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function readCurrentManifest(client: PoolClient): Promise<AttachmentManifestItem[]> {
  const result = await client.query<{ payload: unknown }>(
    "SELECT payload FROM papot_entries_state WHERE scope = 'global'",
  );
  const row = result.rows[0];
  if (!row) throw new Error("ENTRIES_STORAGE_NOT_INITIALIZED");
  return attachmentManifest(parseEntriesPayload(row.payload));
}

async function verifyServerCopy(
  store: ServerFileStore,
  attachment: EntryAttachment,
): Promise<boolean> {
  try {
    const bytes = await store.readBytes(attachment.storagePath, attachment.sha256);
    if (bytes.length !== attachment.sizeBytes) {
      throw new Error("ENTRY_ATTACHMENT_CUTOVER_INTEGRITY_MISMATCH");
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "SERVER_FILE_NOT_FOUND") return false;
    if (error instanceof Error && error.message === "SERVER_FILE_INTEGRITY_MISMATCH") {
      throw new Error("ENTRY_ATTACHMENT_CUTOVER_INTEGRITY_MISMATCH");
    }
    throw error;
  }
}

async function copyLegacyAttachment(
  store: ServerFileStore,
  attachment: EntryAttachment,
  readLegacy: LegacyEntryAttachmentReader,
): Promise<void> {
  if (await verifyServerCopy(store, attachment)) return;

  const bytes = await readLegacy(attachment);
  if (bytes.length !== attachment.sizeBytes || sha256Bytes(bytes) !== attachment.sha256) {
    throw new Error("ENTRY_ATTACHMENT_CUTOVER_INTEGRITY_MISMATCH");
  }

  try {
    await store.writeBytes(attachment.storagePath, bytes);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "SERVER_FILE_EXISTS") throw error;
  }

  if (!(await verifyServerCopy(store, attachment))) {
    throw new Error("ENTRY_ATTACHMENT_CUTOVER_VALIDATION_FAILED");
  }
}

export async function ensureEntryAttachmentFilesCutover(params: {
  pool?: Pool;
  store: ServerFileStore;
  readLegacy: LegacyEntryAttachmentReader;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ENTRY_ATTACHMENT_FILES_CUTOVER_LOCK_ID]);
    lockAcquired = true;
    if (await findCutoverMarker(client)) return;

    const manifest = await readCurrentManifest(client);
    const sourceHash = entryAttachmentManifestHash(manifest);

    for (const { attachment } of manifest) {
      await copyLegacyAttachment(params.store, attachment, params.readLegacy);
    }

    const currentManifest = await readCurrentManifest(client);
    if (entryAttachmentManifestHash(currentManifest) !== sourceHash) {
      throw new Error("ENTRY_ATTACHMENT_CUTOVER_SNAPSHOT_CHANGED");
    }

    await client.query(
      `
        INSERT INTO papot_domain_cutovers (
          domain,
          source,
          source_hash,
          record_count
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        ENTRY_ATTACHMENT_FILES_CUTOVER_DOMAIN,
        ENTRY_ATTACHMENT_FILES_CUTOVER_SOURCE,
        sourceHash,
        manifest.length,
      ],
    );
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [ENTRY_ATTACHMENT_FILES_CUTOVER_LOCK_ID])
        .catch(() => undefined);
    }
    client.release();
  }
}
