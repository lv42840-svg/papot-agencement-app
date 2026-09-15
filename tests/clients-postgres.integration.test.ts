import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientsPayloadHash, ensureClientsPostgresCutover } from "../src/lib/clients/cutover";
import { createInitialClientsPayload } from "../src/lib/clients/domain";
import { applyClientsMutation } from "../src/lib/clients/mutations";
import { createPostgresClientsRepository } from "../src/lib/clients/postgres-repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Test User",
};

function clientInput(clientId: string, companyName: string, siret: string) {
  return {
    action: "create" as const,
    clientId,
    type: "ENTREPRISE" as const,
    companyName,
    firstName: "",
    lastName: "",
    addressLine1: "12 rue des Ateliers",
    addressLine2: "",
    postalCode: "42300",
    city: "Roanne",
    phone: "04 77 00 00 00",
    email: "contact@example.test",
    siret,
    paymentTerms: "45 jours fin de mois",
    notes: "Client test",
    contacts: [],
  };
}

describeWithPostgres("Clients PostgreSQL cutover", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'clients'");
    await pool.query("TRUNCATE TABLE papot_clients");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'clients'");
    await pool.query("TRUNCATE TABLE papot_clients");
    await closeServerDbPool();
  });

  it("installs the Clients storage migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 2",
    );
    const tables = await pool.query<{ clients: string | null; cutovers: string | null }>(
      "SELECT to_regclass('papot_clients')::text AS clients, to_regclass('papot_domain_cutovers')::text AS cutovers",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(tables.rows[0]?.clients).toBe("papot_clients");
    expect(tables.rows[0]?.cutovers).toBe("papot_domain_cutovers");
  });

  it("imports the locked Nextcloud snapshot once and preserves its hash", async () => {
    const source = applyClientsMutation(
      createInitialClientsPayload(),
      clientInput("22222222-2222-4222-8222-222222222222", "PAPOT Test", "12345678901234"),
      actor,
      new Date("2026-09-14T07:00:00.000Z"),
    ).payload;
    const release = vi.fn(async () => undefined);
    const acquireSource = vi.fn(async () => ({ payload: source, release }));

    await ensureClientsPostgresCutover({ pool, acquireSource });

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'clients'",
    );
    const repository = createPostgresClientsRepository(pool);

    await expect(repository.load()).resolves.toEqual(source);
    expect(marker.rows[0]).toEqual({
      source: "nextcloud:CLIENTS/global",
      source_hash: clientsPayloadHash(source),
      record_count: 1,
    });
    expect(acquireSource).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const shouldNotAcquire = vi.fn(async () => {
      throw new Error("source should not be read after cutover");
    });
    await ensureClientsPostgresCutover({ pool, acquireSource: shouldNotAcquire });
    expect(shouldNotAcquire).not.toHaveBeenCalled();
  });

  it("writes Clients only in PostgreSQL after cutover and increments row version", async () => {
    const source = applyClientsMutation(
      createInitialClientsPayload(),
      clientInput("33333333-3333-4333-8333-333333333333", "Client importé", "12345678901234"),
      actor,
      new Date("2026-09-14T07:00:00.000Z"),
    ).payload;
    await ensureClientsPostgresCutover({
      pool,
      acquireSource: async () => ({ payload: source, release: async () => undefined }),
    });

    const repository = createPostgresClientsRepository(pool);
    const createdInput = clientInput(
      "44444444-4444-4444-8444-444444444444",
      "Nouveau client",
      "98765432109876",
    );
    await repository.mutate(createdInput, actor);
    await repository.mutate(
      {
        ...createdInput,
        action: "update",
        companyName: "Nouveau client modifié",
      },
      actor,
    );

    const row = await pool.query<{ version: number; company_name: string }>(
      "SELECT version, record->>'companyName' AS company_name FROM papot_clients WHERE id = $1",
      [createdInput.clientId],
    );
    const loaded = await repository.load();

    expect(row.rows[0]).toEqual({ version: 2, company_name: "Nouveau client modifié" });
    expect(loaded.clients.map((client) => client.id)).toEqual([
      createdInput.clientId,
      source.clients[0].id,
    ]);
  });
});
