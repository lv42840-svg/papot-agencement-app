import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPostgresPlanningRepository } from "../src/lib/planning/postgres-repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;
const chantierId = "11111111-1111-4111-8111-111111111111";

describeWithPostgres("Planning PostgreSQL storage", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `
        UPDATE papot_planning_state
        SET version = 1,
            payload = '{"schemaVersion":1,"macroAllocations":[],"chantierOrder":[]}'::jsonb,
            updated_at = NOW()
        WHERE scope = 'global'
      `,
    );
  });

  afterAll(async () => {
    await closeServerDbPool();
  });

  it("installs and initializes planning storage", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 10",
    );
    const table = await pool.query<{ planning_state: string | null }>(
      "SELECT to_regclass('papot_planning_state')::text AS planning_state",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(table.rows[0]?.planning_state).toBe("papot_planning_state");
    await expect(createPostgresPlanningRepository(pool).load()).resolves.toEqual({
      schemaVersion: 1,
      macroAllocations: [],
      chantierOrder: [],
      peopleCapacity: [],
      absences: [],
    });
  });

  it("serializes concurrent weekly edits without losing either cell", async () => {
    const repositoryA = createPostgresPlanningRepository(pool);
    const repositoryB = createPostgresPlanningRepository(pool);

    await Promise.all([
      repositoryA.mutate((payload) => ({
        ...payload,
        macroAllocations: [
          ...payload.macroAllocations,
          { chantierId, activity: "BE" as const, week: "2026-W40", hours: 8 },
        ],
      })),
      repositoryB.mutate((payload) => ({
        ...payload,
        macroAllocations: [
          ...payload.macroAllocations,
          { chantierId, activity: "WORKSHOP" as const, week: "2026-W40", hours: 20 },
        ],
      })),
    ]);

    const loaded = await repositoryA.load();
    expect(loaded.macroAllocations).toHaveLength(2);
    expect(loaded.macroAllocations).toEqual(
      expect.arrayContaining([
        { chantierId, activity: "BE", week: "2026-W40", hours: 8 },
        { chantierId, activity: "WORKSHOP", week: "2026-W40", hours: 20 },
      ]),
    );

    const row = await pool.query<{ version: number }>(
      "SELECT version FROM papot_planning_state WHERE scope = 'global'",
    );
    expect(row.rows[0]?.version).toBe(3);
  });
});
