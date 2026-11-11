import "server-only";

import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import { parsePayrollPreparation, type PayrollPreparationPayload } from "./preparation";

const KEY = "payroll-preparations";

export async function readPayrollPreparation(): Promise<PayrollPreparationPayload> {
  if (isLocalStorageMode()) {
    return readLocalSnapshot(KEY, parsePayrollPreparation).payload;
  }
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  const lignes = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM papot_payroll_preparation_state WHERE scope = 'global'",
  );
  return parsePayrollPreparation(lignes.rows[0]?.payload);
}

export async function updatePayrollPreparation(
  transformation: (donnees: PayrollPreparationPayload) => PayrollPreparationPayload,
): Promise<PayrollPreparationPayload> {
  if (isLocalStorageMode()) {
    return mutateLocalSnapshot(KEY, parsePayrollPreparation, ({ payload: donnees }) => {
      const donneesSuivantes = transformation(donnees);
      return {
        payload: donneesSuivantes,
        result: donneesSuivantes,
      };
    });
  }
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return withServerDbTransaction(async (client) => {
    const lignes = await client.query<{ payload: unknown }>(
      "SELECT payload FROM papot_payroll_preparation_state WHERE scope = 'global' FOR UPDATE",
    );
    const donneesSuivantes = parsePayrollPreparation(
      transformation(parsePayrollPreparation(lignes.rows[0]?.payload)),
    );
    await client.query(
      "UPDATE papot_payroll_preparation_state SET payload = $1::jsonb, version = version + 1, updated_at = NOW() WHERE scope = 'global'",
      [JSON.stringify(donneesSuivantes)],
    );
    return donneesSuivantes;
  }, pool);
}
