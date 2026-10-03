import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { chantiersPayloadHash, ensureChantiersPostgresCutover } from "../src/lib/chantiers/cutover";
import {
  createInitialChantiersPayload,
  parseChantiersPayload,
  type ChantiersPayload,
} from "../src/lib/chantiers/domain";
import { createPostgresChantiersRepository } from "../src/lib/chantiers/postgres-repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

function appendChantier(source: ChantiersPayload, name: string): ChantiersPayload {
  const timestamp = "2026-09-14T10:00:00.000Z";
  return parseChantiersPayload({
    ...source,
    chantiers: [
      ...source.chantiers,
      {
        id: randomUUID(),
        sourceCommercialCaseId: randomUUID(),
        sourceEntryId: null,
        number: null,
        reference: null,
        name,
        clientName: "Client test",
        companyName: null,
        siteLabel: "Roanne",
        contactName: null,
        contactPhone: null,
        contactEmail: null,
        description: null,
        nextAction: null,
        status: "ACTIVE",
        plannedInstallDate: "2026-10-01",
        launchYear: 2026,
        launchDocuments: {
          quote: "MISSING_DECLARED",
          signedQuote: "MISSING_DECLARED",
          costing: "MISSING_DECLARED",
        },
        signedQuoteReminder: false,
        plannedHours: { be: 0, workshop: 0, install: 0 },
        actualHours: { be: 0, workshop: 0, install: 0 },
        operational: { beItems: [], workshopItems: [], installItems: [] },
        launchedAt: timestamp,
        launchedByName: "Test User",
        completedAt: null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedByName: "Test User",
        history: [],
      },
    ],
  });
}

describeWithPostgres("Chantiers PostgreSQL cutover", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'chantiers'");
    await pool.query("TRUNCATE TABLE papot_chantiers_state");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'chantiers'");
    await pool.query("TRUNCATE TABLE papot_chantiers_state");
    await closeServerDbPool();
  });

  it("installs the Chantiers storage migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 6",
    );
    const table = await pool.query<{ chantiers_state: string | null }>(
      "SELECT to_regclass('papot_chantiers_state')::text AS chantiers_state",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(table.rows[0]?.chantiers_state).toBe("papot_chantiers_state");
  });

  it("imports the locked Nextcloud snapshot once and preserves its hash", async () => {
    const source = appendChantier(createInitialChantiersPayload(), "Chantier importé");
    const release = vi.fn(async () => undefined);
    const acquireSource = vi.fn(async () => ({ payload: source, release }));

    await ensureChantiersPostgresCutover({ pool, acquireSource });

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'chantiers'",
    );
    const repository = createPostgresChantiersRepository(pool);

    await expect(repository.load()).resolves.toEqual(source);
    expect(marker.rows[0]).toEqual({
      source: "nextcloud:CHANTIER/registry",
      source_hash: chantiersPayloadHash(source),
      record_count: 1,
    });
    expect(acquireSource).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const shouldNotAcquire = vi.fn(async () => {
      throw new Error("source should not be read after cutover");
    });
    await ensureChantiersPostgresCutover({ pool, acquireSource: shouldNotAcquire });
    expect(shouldNotAcquire).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a non-empty PostgreSQL state without a cutover marker", async () => {
    const existing = appendChantier(createInitialChantiersPayload(), "État existant");
    await pool.query(
      "INSERT INTO papot_chantiers_state (scope, version, payload) VALUES ('global', 1, $1)",
      [existing],
    );
    const release = vi.fn(async () => undefined);

    await expect(
      ensureChantiersPostgresCutover({
        pool,
        acquireSource: async () => ({
          payload: appendChantier(createInitialChantiersPayload(), "Source Nextcloud"),
          release,
        }),
      }),
    ).rejects.toThrow("CHANTIERS_CUTOVER_STATE_INVALID");

    const repository = createPostgresChantiersRepository(pool);
    await expect(repository.load()).resolves.toEqual(existing);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent Chantiers mutations without losing either chantier", async () => {
    await ensureChantiersPostgresCutover({
      pool,
      acquireSource: async () => ({
        payload: createInitialChantiersPayload(),
        release: async () => undefined,
      }),
    });

    const repositoryA = createPostgresChantiersRepository(pool);
    const repositoryB = createPostgresChantiersRepository(pool);

    await Promise.all([
      repositoryA.mutate((payload) => ({ payload: appendChantier(payload, "Chantier poste A") })),
      repositoryB.mutate((payload) => ({ payload: appendChantier(payload, "Chantier poste B") })),
    ]);

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_chantiers_state WHERE scope = 'global'",
    );
    const loaded = await repositoryA.load();

    expect(row.rows[0]?.version).toBe(3);
    expect(loaded.chantiers).toHaveLength(2);
    expect(loaded.chantiers.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Chantier poste A", "Chantier poste B"]),
    );
  });

  it("does not increment the version for a no-op mutation", async () => {
    await ensureChantiersPostgresCutover({
      pool,
      acquireSource: async () => ({
        payload: createInitialChantiersPayload(),
        release: async () => undefined,
      }),
    });

    const repository = createPostgresChantiersRepository(pool);
    await repository.mutate((payload) => ({ payload, shouldPersist: false }));

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_chantiers_state WHERE scope = 'global'",
    );
    expect(row.rows[0]?.version).toBe(1);
  });
});
