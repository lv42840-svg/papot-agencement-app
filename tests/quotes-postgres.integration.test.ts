import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureQuotesPostgresCutover, quotesPayloadHash } from "../src/lib/quotes/cutover";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { createPostgresQuotesRepository } from "../src/lib/quotes/postgres-repository";
import {
  createInitialNativeQuotesPayload,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "../src/lib/quotes/store";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Test User",
};
const clientId = "22222222-2222-4222-8222-222222222222";
const affairId = "33333333-3333-4333-8333-333333333333";

function appendQuote(source: NativeQuotesPayload, subject: string): NativeQuotesPayload {
  return parseNativeQuotesPayload(
    applyQuotesMutation(
      source,
      quotesMutationSchema.parse({
        action: "createDraft",
        commercialCaseId: affairId,
        subject,
        issueDate: "2026-09-18",
        variantName: "Base",
        paymentTerms: "45 jours fin de mois",
      }),
      actor,
      clientId,
      new Date("2026-09-18T08:00:00.000Z"),
    ).payload,
  );
}

describeWithPostgres("Quotes PostgreSQL cutover", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'quotes'");
    await pool.query("TRUNCATE TABLE papot_quotes_state");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'quotes'");
    await pool.query("TRUNCATE TABLE papot_quotes_state");
    await closeServerDbPool();
  });

  it("installs the Quotes storage migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 9",
    );
    const table = await pool.query<{ quotes_state: string | null }>(
      "SELECT to_regclass('papot_quotes_state')::text AS quotes_state",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(table.rows[0]?.quotes_state).toBe("papot_quotes_state");
  });

  it("imports the local quotes snapshot once and preserves its hash", async () => {
    const source = appendQuote(createInitialNativeQuotesPayload(), "Devis importé");
    const acquireSource = vi.fn(async () => source);

    await ensureQuotesPostgresCutover({ pool, acquireSource });

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'quotes'",
    );
    const repository = createPostgresQuotesRepository(pool);

    await expect(repository.load()).resolves.toEqual(source);
    expect(marker.rows[0]).toEqual({
      source: "local:quotes",
      source_hash: quotesPayloadHash(source),
      record_count: 1,
    });
    expect(acquireSource).toHaveBeenCalledTimes(1);

    const shouldNotAcquire = vi.fn(async () => {
      throw new Error("source should not be read after cutover");
    });
    await ensureQuotesPostgresCutover({ pool, acquireSource: shouldNotAcquire });
    expect(shouldNotAcquire).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a non-empty PostgreSQL state without a cutover marker", async () => {
    const existing = appendQuote(createInitialNativeQuotesPayload(), "État existant");
    await pool.query(
      "INSERT INTO papot_quotes_state (scope, version, payload) VALUES ('global', 1, $1)",
      [existing],
    );

    await expect(
      ensureQuotesPostgresCutover({
        pool,
        acquireSource: async () =>
          appendQuote(createInitialNativeQuotesPayload(), "Source locale"),
      }),
    ).rejects.toThrow("QUOTES_CUTOVER_STATE_INVALID");

    const repository = createPostgresQuotesRepository(pool);
    await expect(repository.load()).resolves.toEqual(existing);
  });

  it("serializes concurrent quote mutations without losing either draft", async () => {
    await ensureQuotesPostgresCutover({
      pool,
      acquireSource: async () => createInitialNativeQuotesPayload(),
    });

    const repositoryA = createPostgresQuotesRepository(pool);
    const repositoryB = createPostgresQuotesRepository(pool);

    await Promise.all([
      repositoryA.mutate((payload) => ({
        payload: appendQuote(payload, "Devis poste A"),
        focusQuoteId: randomUUID(),
      })),
      repositoryB.mutate((payload) => ({
        payload: appendQuote(payload, "Devis poste B"),
        focusQuoteId: randomUUID(),
      })),
    ]);

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_quotes_state WHERE scope = 'global'",
    );
    const loaded = await repositoryA.load();

    expect(row.rows[0]?.version).toBe(3);
    expect(loaded.quotes).toHaveLength(2);
    expect(loaded.quotes.map((quote) => quote.model.subject)).toEqual(
      expect.arrayContaining(["Devis poste A", "Devis poste B"]),
    );
  });

  it("does not increment the version for a no-op mutation", async () => {
    await ensureQuotesPostgresCutover({
      pool,
      acquireSource: async () => createInitialNativeQuotesPayload(),
    });

    const repository = createPostgresQuotesRepository(pool);
    await repository.mutate((payload) => ({
      payload,
      focusQuoteId: randomUUID(),
      shouldPersist: false,
    }));

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_quotes_state WHERE scope = 'global'",
    );
    expect(row.rows[0]?.version).toBe(1);
  });
});
