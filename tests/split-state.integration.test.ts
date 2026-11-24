import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getServerDbPool, closeServerDbPool } from "../src/lib/server-db/pool";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import {
  loadSplitState,
  saveSplitState,
  planningCollections,
  laborCollections,
} from "../src/lib/server-db/split-state";
const suite = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;
suite("split state migration", () => {
  beforeAll(async () => {
    await runServerDbMigrations();
  });
  afterAll(closeServerDbPool);
  it("migrates legacy rows exactly, preserves a recovery copy, updates and deletes lines, and rolls back", async () => {
    const client = await getServerDbPool().connect();
    try {
      await client.query("BEGIN");
      const legacy = {
        schemaVersion: 1,
        macroAllocations: [],
        chantierOrder: [],
        actualHours: [
          { week: "2026-W01", userId: "one", chantierId: "site", activity: "BE", hours: 4 },
        ],
        indirectHours: [],
        editHistory: [{ key: "one", revision: 1 }],
      };
      await client.query(
        "DELETE FROM papot_state_migration_backups WHERE resource='papot_planning_state'",
      );
      await client.query("UPDATE papot_planning_state SET payload=$1 WHERE scope='global'", [
        legacy,
      ]);
      expect(await loadSplitState(client, "papot_planning_state", planningCollections)).toEqual(
        legacy,
      );
      const raw = await client.query(
        "SELECT payload FROM papot_planning_state WHERE scope='global'",
      );
      expect(raw.rows[0].payload).not.toHaveProperty("actualHours");
      expect(
        (
          await client.query(
            "SELECT payload FROM papot_state_migration_backups WHERE resource='papot_planning_state'",
          )
        ).rows[0].payload,
      ).toEqual(legacy);
      const next = { ...legacy, actualHours: [{ ...legacy.actualHours[0], hours: 8 }] };
      await saveSplitState(client, "papot_planning_state", planningCollections, next);
      expect(
        (await loadSplitState(client, "papot_planning_state", planningCollections)).actualHours,
      ).toEqual(next.actualHours);
      await client.query("SAVEPOINT deletion");
      await saveSplitState(client, "papot_planning_state", planningCollections, {
        ...next,
        actualHours: [],
      });
      expect(
        (await loadSplitState(client, "papot_planning_state", planningCollections)).actualHours,
      ).toEqual([]);
      await client.query("ROLLBACK TO SAVEPOINT deletion");
      expect(
        (await loadSplitState(client, "papot_planning_state", planningCollections)).actualHours,
      ).toEqual(next.actualHours);
      await client.query(
        "UPDATE papot_monthly_labor_costs_state SET payload=$1 WHERE scope='global'",
        [
          {
            schemaVersion: 1,
            records: [{ personId: "one", month: "2026-01", employerCostCents: 123 }],
            history: [],
          },
        ],
      );
      const labor = await loadSplitState(
        client,
        "papot_monthly_labor_costs_state",
        laborCollections,
      );
      expect(labor.records).toEqual([
        { personId: "one", month: "2026-01", employerCostCents: 123 },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
