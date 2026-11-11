import "server-only";

import { createPlanningRepository } from "@/lib/planning/create-repository";
import { holdingRecordedHoursForMonth } from "@/lib/payroll/holding-hours";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import {
  mutateLocalSnapshot,
  readLocalSnapshot,
} from "@/lib/local-db/runtime";
import {
  getServerDbPool,
  runServerDbMigrations,
} from "@/lib/server-db";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import {
  parseMonthlyLaborCostsPayload,
  type MonthlyLaborCostsPayload,
} from "./monthly-labor-costs";

type Mutation = (
  donneesCourantes: MonthlyLaborCostsPayload,
) => MonthlyLaborCostsPayload;

const LOCAL_KEY = "monthly-labor-costs";

async function withCurrentHoldingHours(
  donnees: MonthlyLaborCostsPayload,
): Promise<MonthlyLaborCostsPayload> {
  if (
    !donnees.records.some(
      (enregistrement) => enregistrement.sourceType === "HOLDING",
    )
  ) {
    return donnees;
  }
  const planning = await createPlanningRepository().load();
  return {
    ...donnees,
    records: donnees.records.map((enregistrement) =>
      enregistrement.sourceType === "HOLDING"
        ? {
            ...enregistrement,
            workedHours: holdingRecordedHoursForMonth(
              enregistrement.month,
              enregistrement.personId,
              planning,
              planning.peopleCapacity,
            ),
          }
        : enregistrement,
    ),
  };
}

export async function readMonthlyLaborCosts(): Promise<MonthlyLaborCostsPayload> {
  if (isLocalStorageMode()) {
    return withCurrentHoldingHours(
      readLocalSnapshot(
        LOCAL_KEY,
        parseMonthlyLaborCostsPayload,
      ).payload,
    );
  }

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  const resultat = await pool.query<{ payload: unknown }>(
    "SELECT payload FROM papot_monthly_labor_costs_state WHERE scope = 'global'",
  );
  return withCurrentHoldingHours(
    parseMonthlyLaborCostsPayload(resultat.rows[0]?.payload),
  );
}

export async function mutateMonthlyLaborCosts(
  transformation: Mutation,
): Promise<MonthlyLaborCostsPayload> {
  if (isLocalStorageMode()) {
    return mutateLocalSnapshot(
      LOCAL_KEY,
      parseMonthlyLaborCostsPayload,
      ({ payload: donnees }) => {
        const donneesSuivantes = transformation(donnees);
        return {
          payload: donneesSuivantes,
          result: donneesSuivantes,
        };
      },
    );
  }

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return withServerDbTransaction(async (client) => {
    const donneesCourantes = await client.query<{
      payload: unknown;
    }>(
      "SELECT payload FROM papot_monthly_labor_costs_state WHERE scope = 'global' FOR UPDATE",
    );
    const donneesSuivantes = parseMonthlyLaborCostsPayload(
      transformation(
        parseMonthlyLaborCostsPayload(
          donneesCourantes.rows[0]?.payload,
        ),
      ),
    );
    await client.query(
      "UPDATE papot_monthly_labor_costs_state SET payload = $1::jsonb, version = version + 1, updated_at = NOW() WHERE scope = 'global'",
      [JSON.stringify(donneesSuivantes)],
    );
    return donneesSuivantes;
  }, pool);
}
