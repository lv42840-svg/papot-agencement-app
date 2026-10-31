import "server-only";

import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import { parsePayrollPreparation, type PayrollPreparationPayload } from "./preparation";
const KEY = "payroll-preparations";

export async function readPayrollPreparation(): Promise<PayrollPreparationPayload> {
  if (isLocalStorageMode()) return readLocalSnapshot(KEY, parsePayrollPreparation).payload;
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  const rows = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM papot_payroll_preparation_state WHERE scope = 'global'",
  );
  return parsePayrollPreparation(rows.rows[0]?.payload);
}

export async function updatePayrollPreparation(
  transform: (payload: PayrollPreparationPayload) => PayrollPreparationPayload,
): Promise<PayrollPreparationPayload> {
  if (isLocalStorageMode())
    return mutateLocalSnapshot(KEY, parsePayrollPreparation, ({ payload }) => {
      const next = transform(payload);
      return { payload: next, result: next };
    });
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return withServerDbTransaction(async (client) => {
    const rows = await client.query<{ payload: unknown }>(
      "SELECT payload FROM papot_payroll_preparation_state WHERE scope = 'global' FOR UPDATE",
    );
    const next = parsePayrollPreparation(transform(parsePayrollPreparation(rows.rows[0]?.payload)));
    await client.query(
      "UPDATE papot_payroll_preparation_state SET payload = $1::jsonb, version = version + 1, updated_at = NOW() WHERE scope = 'global'",
      [JSON.stringify(next)],
    );
    return next;
  }, pool);
}
