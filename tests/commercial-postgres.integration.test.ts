import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  commercialPayloadHash,
  ensureCommercialPostgresCutover,
} from "../src/lib/commercial/cutover";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createPostgresCommercialRepository } from "../src/lib/commercial/postgres-repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Test User",
};

function createCase(source: ReturnType<typeof createInitialCommercialPayload>, name: string) {
  return applyCommercialMutation(
    source,
    {
      action: "create",
      name,
      clientName: "Client test",
      siteLabel: "Roanne",
      reviewDate: "2026-09-30",
      description: "",
      nextAction: "",
    },
    actor,
    new Date("2026-09-14T10:00:00.000Z"),
  ).payload;
}

describeWithPostgres("Commercial PostgreSQL cutover", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'commercial'");
    await pool.query("TRUNCATE TABLE papot_commercial_state");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'commercial'");
    await pool.query("TRUNCATE TABLE papot_commercial_state");
    await closeServerDbPool();
  });

  it("installs the Commercial storage migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 5",
    );
    const table = await pool.query<{ commercial_state: string | null }>(
      "SELECT to_regclass('papot_commercial_state')::text AS commercial_state",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(table.rows[0]?.commercial_state).toBe("papot_commercial_state");
  });

  it("imports the locked Nextcloud snapshot once and preserves its hash", async () => {
    const source = createCase(createInitialCommercialPayload(), "Affaire importée");
    const release = vi.fn(async () => undefined);
    const acquireSource = vi.fn(async () => ({ payload: source, release }));

    await ensureCommercialPostgresCutover({ pool, acquireSource });

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'commercial'",
    );
    const repository = createPostgresCommercialRepository(pool);

    await expect(repository.load()).resolves.toEqual(source);
    expect(marker.rows[0]).toEqual({
      source: "nextcloud:COMMERCIAL/global",
      source_hash: commercialPayloadHash(source),
      record_count: 1,
    });
    expect(acquireSource).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const shouldNotAcquire = vi.fn(async () => {
      throw new Error("source should not be read after cutover");
    });
    await ensureCommercialPostgresCutover({ pool, acquireSource: shouldNotAcquire });
    expect(shouldNotAcquire).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a non-empty PostgreSQL state without a cutover marker", async () => {
    const existing = createCase(createInitialCommercialPayload(), "État existant");
    await pool.query(
      "INSERT INTO papot_commercial_state (scope, version, payload) VALUES ('global', 1, $1)",
      [existing],
    );
    const release = vi.fn(async () => undefined);

    await expect(
      ensureCommercialPostgresCutover({
        pool,
        acquireSource: async () => ({
          payload: createCase(createInitialCommercialPayload(), "Source Nextcloud"),
          release,
        }),
      }),
    ).rejects.toThrow("COMMERCIAL_CUTOVER_STATE_INVALID");

    const repository = createPostgresCommercialRepository(pool);
    await expect(repository.load()).resolves.toEqual(existing);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent Commercial mutations without losing either affair", async () => {
    await ensureCommercialPostgresCutover({
      pool,
      acquireSource: async () => ({
        payload: createInitialCommercialPayload(),
        release: async () => undefined,
      }),
    });

    const repositoryA = createPostgresCommercialRepository(pool);
    const repositoryB = createPostgresCommercialRepository(pool);

    await Promise.all([
      repositoryA.mutate((payload) => ({ payload: createCase(payload, "Affaire poste A") })),
      repositoryB.mutate((payload) => ({ payload: createCase(payload, "Affaire poste B") })),
    ]);

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_commercial_state WHERE scope = 'global'",
    );
    const loaded = await repositoryA.load();

    expect(row.rows[0]?.version).toBe(3);
    expect(loaded.cases).toHaveLength(2);
    expect(loaded.cases.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Affaire poste A", "Affaire poste B"]),
    );
  });

  it("does not increment the version for a no-op mutation", async () => {
    await ensureCommercialPostgresCutover({
      pool,
      acquireSource: async () => ({
        payload: createInitialCommercialPayload(),
        release: async () => undefined,
      }),
    });

    const repository = createPostgresCommercialRepository(pool);
    await repository.mutate((payload) => ({ payload, shouldPersist: false }));

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_commercial_state WHERE scope = 'global'",
    );
    expect(row.rows[0]?.version).toBe(1);
  });
});
