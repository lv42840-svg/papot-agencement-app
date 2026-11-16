import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import { getPennylaneSnapshots, publishPennylaneSnapshots } from "../src/lib/pennylane/store";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

describeWithPostgres("Pennylane transactional staging", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  afterAll(async () => {
    await closeServerDbPool();
  });

  it("replaces previous records without duplication and keeps all datasets isolated", async () => {
    const records = {
      suppliers: [{ id: 991991, name: "Supplier" }],
      supplier_invoices: [{ id: 992992 }],
      customers: [{ id: 993993 }],
      customer_invoices: [{ id: 994994 }],
    };
    await publishPennylaneSnapshots("PAPOT LIBERAL", records, pool);
    await publishPennylaneSnapshots("PAPOT LIBERAL", records, pool);
    const before = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_pennylane_staging",
    );
    expect(Number(before.rows[0]?.count)).toBe(4);

    await publishPennylaneSnapshots(
      "PAPOT LIBERAL",
      {
        suppliers: [{ id: 991991, name: "Updated" }],
        supplier_invoices: [],
        customers: [],
        customer_invoices: [],
      },
      pool,
    );
    const after = await pool.query<{ resource: string; payload: { name: string } }>(
      "SELECT resource, payload FROM papot_pennylane_staging",
    );
    expect(after.rows).toEqual([
      { resource: "suppliers", payload: { id: 991991, name: "Updated" } },
    ]);
    const states = await getPennylaneSnapshots(pool);
    expect(states).toHaveLength(4);
    expect(states.find((row) => row.resource === "supplier_invoices")?.count).toBe(0);
  });
});
