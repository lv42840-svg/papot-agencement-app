import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureEntryAttachmentFilesCutover } from "../src/lib/entries/attachment-file-cutover";
import { entriesPayloadHash, ensureEntriesPostgresCutover } from "../src/lib/entries/cutover";
import { createInitialEntriesPayload } from "../src/lib/entries/domain";
import { applyEntriesMutation, registerEntryAttachments } from "../src/lib/entries/mutations";
import { createPostgresEntriesRepository } from "../src/lib/entries/postgres-repository";
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

function createInput(entryId: string, rawText: string) {
  return {
    action: "create" as const,
    entryId,
    rawText,
    priority: "NORMAL" as const,
    tagIds: ["contact"],
  };
}

function payloadWithAttachment(bytes: Buffer) {
  const entryId = "77777777-7777-4777-8777-777777777777";
  const attachmentId = "88888888-8888-4888-8888-888888888888";
  const created = applyEntriesMutation(
    createInitialEntriesPayload(),
    createInput(entryId, "Entrée avec pièce jointe"),
    actor,
    new Date("2026-09-14T09:00:00.000Z"),
  );
  const attachment = {
    id: attachmentId,
    fileName: "preuve.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.length,
    sha256: sha256Bytes(bytes),
    storagePath: `documents/entries/${entryId}/${attachmentId}/preuve.pdf`,
    uploadedAt: "2026-09-14T09:01:00.000Z",
    uploadedByName: actor.displayName,
  };
  const registered = registerEntryAttachments(
    created.payload,
    entryId,
    [attachment],
    actor,
    new Date("2026-09-14T09:01:00.000Z"),
  );
  return { payload: registered.payload, attachment };
}

describeWithPostgres("Entries PostgreSQL cutover", () => {
  let pool: Pool;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      "DELETE FROM papot_domain_cutovers WHERE domain IN ('entries', 'entry_attachment_files')",
    );
    await pool.query("TRUNCATE TABLE papot_entries_state");
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM papot_domain_cutovers WHERE domain IN ('entries', 'entry_attachment_files')",
    );
    await pool.query("TRUNCATE TABLE papot_entries_state");
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    await closeServerDbPool();
  });

  async function createStore() {
    const root = await mkdtemp(path.join(os.tmpdir(), "papot-entry-cutover-"));
    tempRoots.push(root);
    return new ServerFileStore(root);
  }

  it("installs the Entries storage migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 4",
    );
    const table = await pool.query<{ entries_state: string | null }>(
      "SELECT to_regclass('papot_entries_state')::text AS entries_state",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(table.rows[0]?.entries_state).toBe("papot_entries_state");
  });

  it("imports the locked Nextcloud snapshot once and preserves its hash", async () => {
    const source = applyEntriesMutation(
      createInitialEntriesPayload(),
      createInput("22222222-2222-4222-8222-222222222222", "Entrée importée"),
      actor,
      new Date("2026-09-14T09:00:00.000Z"),
    ).payload;
    const release = vi.fn(async () => undefined);
    const acquireSource = vi.fn(async () => ({ payload: source, release }));

    await ensureEntriesPostgresCutover({ pool, acquireSource });

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'entries'",
    );
    const repository = createPostgresEntriesRepository(pool);

    await expect(repository.load()).resolves.toEqual(source);
    expect(marker.rows[0]).toEqual({
      source: "nextcloud:ENTRIES/global",
      source_hash: entriesPayloadHash(source),
      record_count: 1,
    });
    expect(acquireSource).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const shouldNotAcquire = vi.fn(async () => {
      throw new Error("source should not be read after cutover");
    });
    await ensureEntriesPostgresCutover({ pool, acquireSource: shouldNotAcquire });
    expect(shouldNotAcquire).not.toHaveBeenCalled();
  });

  it("writes Entries metadata only in PostgreSQL after cutover", async () => {
    const source = createInitialEntriesPayload();
    await ensureEntriesPostgresCutover({
      pool,
      acquireSource: async () => ({ payload: source, release: async () => undefined }),
    });

    const repository = createPostgresEntriesRepository(pool);
    const entryId = "33333333-3333-4333-8333-333333333333";
    await repository.mutate(createInput(entryId, "Nouvelle entrée"), actor);
    await repository.registerAttachments(
      entryId,
      [
        {
          id: "44444444-4444-4444-8444-444444444444",
          fileName: "plan.pdf",
          contentType: "application/pdf",
          sizeBytes: 123,
          sha256: "a".repeat(64),
          storagePath: `documents/entries/${entryId}/plan.pdf`,
          uploadedAt: "2026-09-14T09:05:00.000Z",
          uploadedByName: actor.displayName,
        },
      ],
      actor,
    );

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_entries_state WHERE scope = 'global'",
    );
    const loaded = await repository.load();
    const entry = loaded.entries.find((candidate) => candidate.id === entryId);

    expect(row.rows[0]?.version).toBe(3);
    expect(entry?.attachments).toHaveLength(1);
    expect(entry?.attachments[0]?.fileName).toBe("plan.pdf");
  });

  it("serializes concurrent mutations without losing either entry", async () => {
    await ensureEntriesPostgresCutover({
      pool,
      acquireSource: async () => ({
        payload: createInitialEntriesPayload(),
        release: async () => undefined,
      }),
    });

    const repositoryA = createPostgresEntriesRepository(pool);
    const repositoryB = createPostgresEntriesRepository(pool);
    const entryA = "55555555-5555-4555-8555-555555555555";
    const entryB = "66666666-6666-4666-8666-666666666666";

    await Promise.all([
      repositoryA.mutate(createInput(entryA, "Entrée poste A"), actor),
      repositoryB.mutate(createInput(entryB, "Entrée poste B"), actor),
    ]);

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_entries_state WHERE scope = 'global'",
    );
    const loaded = await repositoryA.load();

    expect(row.rows[0]?.version).toBe(3);
    expect(loaded.entries).toHaveLength(2);
    expect(loaded.entries.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([entryA, entryB]),
    );
  });

  it("copies each legacy attachment once when two posts trigger file cutover together", async () => {
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

  it("does not mark file cutover complete when legacy bytes fail integrity validation", async () => {
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
