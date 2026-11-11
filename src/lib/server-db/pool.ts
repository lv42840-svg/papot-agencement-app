import { Pool } from "pg";

import { getServerDbConfig } from "./config";

type GlobalServerDb = typeof globalThis & {
  __papotServerDbPool?: Pool;
};

export function getServerDbPool(): Pool {
  const baseGlobale = globalThis as GlobalServerDb;

  if (!baseGlobale.__papotServerDbPool) {
    const configuration = getServerDbConfig();

    baseGlobale.__papotServerDbPool = new Pool({
      connectionString: configuration.connectionString,
      application_name: configuration.applicationName,
      max: configuration.maxConnections,
      connectionTimeoutMillis:
        configuration.connectionTimeoutMillis,
      idleTimeoutMillis: configuration.idleTimeoutMillis,
    });
  }

  return baseGlobale.__papotServerDbPool;
}

export async function closeServerDbPool(): Promise<void> {
  const baseGlobale = globalThis as GlobalServerDb;
  const pool = baseGlobale.__papotServerDbPool;

  if (!pool) return;

  baseGlobale.__papotServerDbPool = undefined;
  await pool.end();
}
