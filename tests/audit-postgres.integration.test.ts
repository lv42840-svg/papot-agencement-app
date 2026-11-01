import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("server-only", () => ({}));
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { getServerDbPool, closeServerDbPool } from "../src/lib/server-db/pool";
import { withServerDbTransaction } from "../src/lib/server-db/transaction";
import { createPostgresPlanningRepository } from "../src/lib/planning/postgres-repository";
import { lockAuthMutation } from "../src/lib/auth/transaction-lock";
import { createPostgresAuthRepository } from "../src/lib/auth/postgres-repository";

const suite = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;
suite("audit PostgreSQL atomicity and auth coordination", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });
  afterAll(closeServerDbPool);
  it("rolls back a first module write when the second module fails", async () => {
    const repository = createPostgresPlanningRepository(pool);
    const before = await repository.load();
    await expect(
      withServerDbTransaction(async () => {
        await repository.mutate((payload) => ({
          ...payload,
          chantierOrder: ["11111111-1111-4111-8111-111111111111"],
        }));
        throw new Error("second module failed");
      }, pool),
    ).rejects.toThrow("second module failed");
    expect(await repository.load()).toEqual(before);
  });
  it("blocks a snapshot writer while a direct auth writer owns the common lock", async () => {
    const direct = await pool.connect();
    await direct.query("BEGIN");
    await lockAuthMutation(direct);
    let completed = false;
    const pending = createPostgresAuthRepository(pool)
      .mutate(() => undefined)
      .then(() => {
        completed = true;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(completed).toBe(false);
    } finally {
      await direct.query("ROLLBACK");
      direct.release();
    }
    await pending;
    expect(completed).toBe(true);
  });
});
