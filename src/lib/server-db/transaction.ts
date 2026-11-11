import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { getServerDbPool } from "./pool";

const active = new AsyncLocalStorage<{
  client: PoolClient;
  pool: Pool;
  failed: boolean;
}>();

export async function withServerDbTransaction<T>(
  rappel: (client: PoolClient) => Promise<T>,
  pool: Pool = getServerDbPool(),
): Promise<T> {
  const parent = active.getStore();
  if (parent && parent.pool === pool) {
    try {
      return await rappel(parent.client);
    } catch (erreur) {
      parent.failed = true;
      throw erreur;
    }
  }
  const client = await pool.connect();
  const contexte = { client, pool, failed: false };
  try {
    await client.query("BEGIN");
    const resultat = await active.run(contexte, () =>
      rappel(client),
    );
    if (contexte.failed) throw new Error("TRANSACTION_ABORTED");
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* Preserve original error. */
    }
    throw erreur;
  } finally {
    client.release();
  }
}
