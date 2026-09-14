import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureEntryAttachmentFilesCutover } from "../src/lib/entries/attachment-file-cutover";
import { createInitialEntriesPayload } from "../src/lib/entries/domain";
import { applyEntriesMutation, registerEntryAttachments } from "../src/lib/entries/mutations";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import { ServerFileStore, sha256Bytes } from "../src/lib/server-files/storage";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Test User",
  canQualify: true,
  canManageTags: true,
};

const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";

function payloadWithAttachment(bytes: Buffer) {
  const created = applyEntriesMutation(
    createInitialEntriesPayload(),
    {
      action: "create" as const,
      entryId: ENTRY_ID,
      rawText: "Entrée avec pièce jointe",
      priority: "NORMAL" as const,
      tagIds: ["contact"],
    },
    actor,
    new Date("2026-09-14T09:00:00.000Z"),
  );
  const attachment = {
    id: ATTACHMENT_ID,
    fileName: "preuve.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.length,
    sha256: sha256Bytes(bytes),
    storagePath: `documents/entries/${ENTRY_ID}/${ATTACHMENT_ID}/preuve.pdf`,
    uploadedAt: "2026-09-14T09:01:00.000Z",
    uploadedByName: "Test User",
  };
  const registered = registerEntryAttachments(
    created.payload,
    ENTRY_ID,
    [attachment],
    actor,
    new Date("2026-09-14T09:01:00.000Z"),
  );
  return { payload: registered.payload, attachment };
}

describeWithPostgres("Entry attachment file cutover", () => {
  let pool: Pool;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'entry_attachment_files'");
    await pool.query("TRUNCATE TABLE papot_entries_state");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'entry_attachment_files'");
    await pool.query("TRUNCATE TABLE papot_entries_state");
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    await closeServerDbPool();
  });

  async function createStore() {
    const root = await mkdtemp(path.join(os.tmpdir(), "papot-entry-cutover-"));
    tempRoots.push(root);
    return new ServerFileStore(root);
  }

  it("copies the legacy Nextcloud file once under concurrent cutover attempts", async () => {
    const legacyBytes = Buffer.from("ancien fichier nextcloud");
    const { payload, attachment } = payloadWithAttachment(legacyBytes);
    await pool.query(
      "INSERT INTO papot_entries_state (scope, version, payload) VALUES ('global', 1, $1)",
      [payload],
    );
    const store = await createStore();
    const readLegacy = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return legacyBytes;
    });

    await Promise.all([
      ensureEntryAttachmentFilesCutover({ pool, store, readLegacy }),
      ensureEntryAttachmentFilesCutover({ pool, store, readLegacy }),
    ]);

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'entry_attachment_files'",
    );
    const copied = await store.readBytes(attachment.storagePath, attachment.sha256);

    expect(copied.equals(legacyBytes)).toBe(true);
    expect(readLegacy).toHaveBeenCalledTimes(1);
    expect(marker.rows[0]?.source).toBe("nextcloud:documents/entries+captures");
    expect(marker.rows[0]?.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(marker.rows[0]?.record_count).toBe(1);

    await ensureEntryAttachmentFilesCutover({ pool, store, readLegacy });
    expect(readLegacy).toHaveBeenCalledTimes(1);
  });

  it("refuses to mark cutover complete when legacy bytes fail integrity validation", async () => {
    const legacyBytes = Buffer.from("fichier attendu");
    const { payload } = payloadWithAttachment(legacyBytes);
    await pool.query(
      "INSERT INTO papot_entries_state (scope, version, payload) VALUES ('global', 1, $1)",
      [payload],
    );
    const store = await createStore();

    await expect(
      ensureEntryAttachmentFilesCutover({
        pool,
        store,
        readLegacy: async () => Buffer.from("fichier corrompu"),
      }),
    ).rejects.toThrow("ENTRY_ATTACHMENT_CUTOVER_INTEGRITY_MISMATCH");

    const marker = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_domain_cutovers WHERE domain = 'entry_attachment_files'",
    );
    expect(marker.rows[0]?.count).toBe("0");
  });
});
