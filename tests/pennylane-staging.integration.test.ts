import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";
import { getPennylaneSnapshots, publishPennylaneSnapshots } from "../src/lib/pennylane/store";
import {
  getPennylaneConnectionOverview,
  savePennylaneConnection,
  readPennylaneStoredConfig,
  recordPennylaneConnectionTest,
  removePennylaneConnection,
} from "../src/lib/pennylane/connection";

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
  it("stores only authenticated ciphertext, rotates tokens and deletes staged data on disconnect", async () => {
    const env = { PAPOT_PENNYLANE_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString("base64") };
    const token = "fake-pennylane-secret-integration-test";
    await savePennylaneConnection(token, "PAPOT LIBERAL", pool, env);
    const row = await pool.query<{ sealed_token: string }>(
      "SELECT sealed_token FROM papot_pennylane_connection WHERE scope = 'global'",
    );
    expect(row.rows[0]?.sealed_token).toMatch(/^v1:/);
    expect(row.rows[0]?.sealed_token).not.toContain(token);

    const publicStatus = await getPennylaneConnectionOverview(pool, env);
    expect(publicStatus.configured).toBe(true);
    expect(publicStatus.encryptionReady).toBe(true);
    expect(JSON.stringify(publicStatus)).not.toContain(token);
    await expect(readPennylaneStoredConfig(pool, env)).resolves.toEqual({
      token,
      expectedCompany: "PAPOT LIBERAL",
    });

    await recordPennylaneConnectionTest(
      {
        companyName: "PAPOT LIBERAL",
        access: {
          suppliers: "allowed",
          supplier_invoices: "forbidden",
          customers: "allowed",
          customer_invoices: "forbidden",
        },
      },
      pool,
    );
    const tested = await getPennylaneConnectionOverview(pool, env);
    expect(tested.lastTest?.access.supplier_invoices).toBe("forbidden");

    await savePennylaneConnection(token + "-rotated", "PAPOT LIBERAL", pool, env);
    const rotated = await getPennylaneConnectionOverview(pool, env);
    expect(rotated.lastTest).toBeNull();
    expect((await readPennylaneStoredConfig(pool, env)).token).toBe(token + "-rotated");

    await removePennylaneConnection(pool);
    expect((await getPennylaneConnectionOverview(pool, env)).configured).toBe(false);
    const leftovers = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_pennylane_staging",
    );
    expect(leftovers.rows[0]?.count).toBe("0");
    await expect(readPennylaneStoredConfig(pool, env)).rejects.toThrow("PENNYLANE_NOT_CONFIGURED");
  });
});
