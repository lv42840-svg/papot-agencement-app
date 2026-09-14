import { Pool } from "pg";

import { getServerDbConfig } from "./config";

type GlobalServerDb = typeof globalThis & {
  __papotServerDbPool?: Pool;
};

export function getServerDbPool(): Pool {
  const globalServerDb = globalThis as GlobalServerDb;

  if (!globalServerDb.__papotServerDbPool) {
    const config = getServerDbConfig();

    globalServerDb.__papotServerDbPool = new Pool({
      connectionString: config.connectionString,
      application_name: config.applicationName,
      max: config.maxConnections,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      idleTimeoutMillis: config.idleTimeoutMillis,
    });
  }

  return globalServerDb.__papotServerDbPool;
}

export async function closeServerDbPool(): Promise<void> {
  const globalServerDb = globalThis as GlobalServerDb;
  const pool = globalServerDb.__papotServerDbPool;

  if (!pool) {
    return;
  }

  globalServerDb.__papotServerDbPool = undefined;
  await pool.end();
}
