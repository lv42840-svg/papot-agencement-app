import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import {
  parseMonthlyLaborCostsPayload,
  type MonthlyLaborCostsPayload,
} from "./monthly-labor-costs";

type Mutation = (current: MonthlyLaborCostsPayload) => MonthlyLaborCostsPayload;

const LOCAL_KEY = "monthly-labor-costs";

export async function readMonthlyLaborCosts(): Promise<MonthlyLaborCostsPayload> {
  if (isLocalStorageMode()) {
    return readLocalSnapshot(LOCAL_KEY, parseMonthlyLaborCostsPayload).payload;
  }

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  const result = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM papot_monthly_labor_costs_state WHERE scope = 'global'",
  );
  return parseMonthlyLaborCostsPayload(result.rows[0]?.payload);
}

export async function mutateMonthlyLaborCosts(
  transform: Mutation,
): Promise<MonthlyLaborCostsPayload> {
  if (isLocalStorageMode()) {
    return mutateLocalSnapshot(LOCAL_KEY, parseMonthlyLaborCostsPayload, ({ payload }) => {
      const next = transform(payload);
      return { payload: next, result: next };
    });
  }

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return withServerDbTransaction(async (client) => {
    const current = await client.query<{ payload: unknown }>(
      "SELECT payload FROM papot_monthly_labor_costs_state WHERE scope = 'global' FOR UPDATE",
    );
    const next = parseMonthlyLaborCostsPayload(
      transform(parseMonthlyLaborCostsPayload(current.rows[0]?.payload)),
    );
    await client.query(
      "UPDATE papot_monthly_labor_costs_state SET payload = $1::jsonb, version = version + 1, updated_at = NOW() WHERE scope = 'global'",
      [JSON.stringify(next)],
    );
    return next;
  }, pool);
}
