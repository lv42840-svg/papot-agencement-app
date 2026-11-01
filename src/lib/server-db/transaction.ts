import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { getServerDbPool } from "./pool";
const active = new AsyncLocalStorage<{ client: PoolClient; pool: Pool; failed: boolean }>();
export async function withServerDbTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  pool: Pool = getServerDbPool(),
): Promise<T> {
  const parent = active.getStore();
  if (parent && parent.pool === pool) {
    try {
      return await callback(parent.client);
    } catch (error) {
      parent.failed = true;
      throw error;
    }
  }
  const client = await pool.connect();
  const scope = { client, pool, failed: false };
  try {
    await client.query("BEGIN");
    const result = await active.run(scope, () => callback(client));
    if (scope.failed) throw new Error("TRANSACTION_ABORTED");
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* Preserve original error. */
    }
    throw error;
  } finally {
    client.release();
  }
}
