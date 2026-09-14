import { afterAll, describe, expect, it } from "vitest";

import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import { withServerDbTransaction } from "../src/lib/server-db/transaction";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

describeWithPostgres("central PostgreSQL foundation", () => {
  const pool = getServerDbPool();
  const suffix = `${process.pid}_${Date.now()}`;
  const committedTable = `papot_tx_commit_${suffix}`;
  const rolledBackTable = `papot_tx_rollback_${suffix}`;

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${committedTable}`);
    await pool.query(`DROP TABLE IF EXISTS ${rolledBackTable}`);
    await closeServerDbPool();
  });

  it("connects to PostgreSQL", async () => {
    const result = await pool.query<{ value: number }>("SELECT 1 AS value");
    expect(result.rows[0]?.value).toBe(1);
  });

  it("bootstraps the migration registry idempotently", async () => {
    await runServerDbMigrations(pool);
    await runServerDbMigrations(pool);

    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 1",
    );

    expect(result.rows[0]?.count).toBe("1");
  });

  it("commits successful transactions", async () => {
    await withServerDbTransaction(async (client) => {
      await client.query(`CREATE TABLE ${committedTable} (id INTEGER PRIMARY KEY)`);
    }, pool);

    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass($1)::text AS table_name",
      [committedTable],
    );

    expect(result.rows[0]?.table_name).toBe(committedTable);
  });

  it("rolls back failed transactions", async () => {
    await expect(
      withServerDbTransaction(async (client) => {
        await client.query(`CREATE TABLE ${rolledBackTable} (id INTEGER PRIMARY KEY)`);
        throw new Error("forced rollback");
      }, pool),
    ).rejects.toThrow("forced rollback");

    const result = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass($1)::text AS table_name",
      [rolledBackTable],
    );

    expect(result.rows[0]?.table_name).toBeNull();
  });
});
