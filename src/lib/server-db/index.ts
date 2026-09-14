import "server-only";

import type { Pool } from "pg";

import { runServerDbMigrations } from "./migrations";
import { getServerDbPool } from "./pool";
import { withServerDbTransaction } from "./transaction";

export async function verifyServerDbConnection(
  pool: Pool = getServerDbPool(),
): Promise<void> {
  await pool.query("SELECT 1");
}

export {
  getServerDbPool,
  runServerDbMigrations,
  withServerDbTransaction,
};
