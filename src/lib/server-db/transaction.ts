import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "./pool";

export async function withServerDbTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  pool: Pool = getServerDbPool(),
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original transaction error: it is the actionable failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
