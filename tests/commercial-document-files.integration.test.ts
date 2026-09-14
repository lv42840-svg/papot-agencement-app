import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureCommercialDocumentFilesCutover } from "../src/lib/commercial/document-file-cutover";
import { readCommercialDocument } from "../src/lib/commercial/document-storage";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import { ServerFileStore, sha256Bytes } from "../src/lib/server-files/storage";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Test User",
};

function payloadWithDocument(bytes: Buffer) {
  const created = applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: "Affaire avec document",
      clientName: "Client test",
      siteLabel: "Roanne",
      reviewDate: "2026-09-30",
      description: "",
      nextAction: "",
    },
    actor,
    new Date("2026-09-14T10:00:00.000Z"),
  ).payload;
  const item = created.cases[0];
  if (!item) throw new Error("TEST_COMMERCIAL_CASE_MISSING");

  const document = {
    id: "88888888-8888-4888-8888-888888888888",
    fileName: "devis.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.length,
    sha256: sha256Bytes(bytes),
    storagePath: `documents/commercial/2026/${item.id}/quote/88888888-8888-4888-8888-888888888888/devis.pdf`,
    category: "QUOTE" as const,
    versionLabel: null,
    variantLabel: null,
    isCurrent: true,
    isSignedQuote: false,
    legacySignedQuote: false,
    uploadedAt: "2026-09-14T10:01:00.000Z",
    uploadedByName: actor.displayName,
  };
  item.documents.push(document);
  return { payload: created, document };
}

describeWithPostgres("Commercial document files cutover", () => {
  let pool: Pool;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      "DELETE FROM papot_domain_cutovers WHERE domain = 'commercial_document_files'",
    );
    await pool.query("TRUNCATE TABLE papot_commercial_state");
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM papot_domain_cutovers WHERE domain = 'commercial_document_files'",
    );
    await pool.query("TRUNCATE TABLE papot_commercial_state");
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    await closeServerDbPool();
  });

  async function createStore() {
    const root = await mkdtemp(path.join(os.tmpdir(), "papot-commercial-cutover-"));
    tempRoots.push(root);
    return new ServerFileStore(root);
  }

  it("copies each legacy document once when two posts trigger cutover together", async () => {
    const legacyBytes = Buffer.from("ancien devis nextcloud");
    const { payload, document } = payloadWithDocument(legacyBytes);
    await pool.query(
      "INSERT INTO papot_commercial_state (scope, version, payload) VALUES ('global', 1, $1)",
      [payload],
    );
    const store = await createStore();
    const readLegacy = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return legacyBytes;
    });

    await Promise.all([
      ensureCommercialDocumentFilesCutover({ pool, store, readLegacy }),
      ensureCommercialDocumentFilesCutover({ pool, store, readLegacy }),
    ]);

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'commercial_document_files'",
    );
    const copied = await readCommercialDocument({ store }, document);

    expect(copied.equals(legacyBytes)).toBe(true);
    expect(readLegacy).toHaveBeenCalledTimes(1);
    expect(marker.rows[0]?.source).toBe("nextcloud:documents/commercial");
    expect(marker.rows[0]?.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(marker.rows[0]?.record_count).toBe(1);

    await ensureCommercialDocumentFilesCutover({ pool, store, readLegacy });
    expect(readLegacy).toHaveBeenCalledTimes(1);
  });

  it("does not mark cutover complete when legacy bytes fail integrity validation", async () => {
    const legacyBytes = Buffer.from("devis attendu");
    const { payload } = payloadWithDocument(legacyBytes);
    await pool.query(
      "INSERT INTO papot_commercial_state (scope, version, payload) VALUES ('global', 1, $1)",
      [payload],
    );
    const store = await createStore();

    await expect(
      ensureCommercialDocumentFilesCutover({
        pool,
        store,
        readLegacy: async () => Buffer.from("devis corrompu"),
      }),
    ).rejects.toThrow("COMMERCIAL_DOCUMENT_CUTOVER_INTEGRITY_MISMATCH");

    const marker = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_domain_cutovers WHERE domain = 'commercial_document_files'",
    );
    expect(marker.rows[0]?.count).toBe("0");
  });
});
