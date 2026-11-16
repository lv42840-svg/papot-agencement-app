import "server-only";

import type { Pool } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import type { PennylaneConfig } from "./config";
import { pennylaneEnabled } from "./config";
import type { PennylaneAccessProbe } from "./client";
import { pennylaneEncryptionReady, sealPennylaneToken, unsealPennylaneToken } from "./secret-crypto";

export const DEFAULT_PENNYLANE_COMPANY = "PAPOT LIBERAL";

type StoredConnection = {
  expected_company: string;
  sealed_token: string;
  updated_at: Date;
  last_tested_at: Date | null;
  last_test_status: PennylaneAccessProbe | null;
};

export type PennylaneConnectionOverview = {
  configured: boolean;
  encryptionReady: boolean;
  syncEnabled: boolean;
  expectedCompany: string;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTest: PennylaneAccessProbe | null;
};

async function loadConnection(pool: Pool): Promise<StoredConnection | null> {
  const result = await pool.query<StoredConnection>(
    `SELECT expected_company, sealed_token, updated_at, last_tested_at, last_test_status
     FROM papot_pennylane_connection WHERE scope = 'global'`,
  );
  return result.rows[0] ?? null;
}

/** Metadata only; never expose the encrypted or decrypted token to browser responses. */
export async function getPennylaneConnectionOverview(
  pool: Pool = getServerDbPool(),
  env: Record<string, string | undefined> = process.env,
): Promise<PennylaneConnectionOverview> {
  const connection = await loadConnection(pool);
  return {
    configured: Boolean(connection),
    encryptionReady: pennylaneEncryptionReady(env),
    syncEnabled: pennylaneEnabled(env),
    expectedCompany: connection?.expected_company ?? DEFAULT_PENNYLANE_COMPANY,
    updatedAt: connection?.updated_at.toISOString() ?? null,
    lastTestedAt: connection?.last_tested_at?.toISOString() ?? null,
    lastTest: connection?.last_test_status ?? null,
  };
}

export async function savePennylaneConnection(
  token: string,
  expectedCompany: string,
  pool: Pool = getServerDbPool(),
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const sealed = sealPennylaneToken(token, env);
  await pool.query(
    `INSERT INTO papot_pennylane_connection (scope, sealed_token, expected_company)
     VALUES ('global', $1, $2)
     ON CONFLICT (scope) DO UPDATE SET
       sealed_token = EXCLUDED.sealed_token,
       expected_company = EXCLUDED.expected_company,
       updated_at = NOW(),
       last_tested_at = NULL,
       last_test_status = NULL`,
    [sealed, expectedCompany],
  );
}

export async function readPennylaneStoredConfig(
  pool: Pool = getServerDbPool(),
  env: Record<string, string | undefined> = process.env,
): Promise<PennylaneConfig> {
  const connection = await loadConnection(pool);
  if (!connection) throw new Error("PENNYLANE_NOT_CONFIGURED");
  return {
    expectedCompany: connection.expected_company,
    token: unsealPennylaneToken(connection.sealed_token, env),
  };
}

export async function recordPennylaneConnectionTest(
  status: PennylaneAccessProbe,
  pool: Pool = getServerDbPool(),
): Promise<void> {
  // The test only records safe status labels and the verified company, not any API payload.
  await pool.query(
    `UPDATE papot_pennylane_connection
     SET last_tested_at = NOW(), last_test_status = $1::jsonb
     WHERE scope = 'global'`,
    [JSON.stringify(status)],
  );
}

/** Disconnect and remove the isolated imported data, never PAPOT business data. */
export async function removePennylaneConnection(pool: Pool = getServerDbPool()): Promise<void> {
  await withServerDbTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", ["7332170416238558"]);
    await client.query("DELETE FROM papot_pennylane_connection WHERE scope = 'global'");
    await client.query("DELETE FROM papot_pennylane_staging");
    await client.query("DELETE FROM papot_pennylane_sync_state");
  }, pool);
}
