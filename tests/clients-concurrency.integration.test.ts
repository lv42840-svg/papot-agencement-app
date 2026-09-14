import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPostgresClientsRepository } from "../src/lib/clients/postgres-repository";
import { ClientsRepositoryError } from "../src/lib/clients/repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const actorA = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Poste A",
};
const actorB = {
  userId: "22222222-2222-4222-8222-222222222222",
  displayName: "Poste B",
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

function createTwoPartyBarrier() {
  let arrivals = 0;
  let openBarrier: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    openBarrier = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === 2) openBarrier();
    await barrier;
  };
}

function createSnapshotSynchronizedPool(
  pool: Pool,
  waitAtSnapshot: () => Promise<void>,
  connectionIds: Set<number>,
): Pool {
  return {
    connect: async () => {
      const client = await pool.connect();
      const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const backendPid = backend.rows[0]?.pid;
      if (backendPid != null) connectionIds.add(backendPid);

      const query = client.query.bind(client) as unknown as (
        text: string,
        values?: unknown[],
      ) => Promise<unknown>;
      let synchronized = false;

      return {
        query: async (text: string, values?: unknown[]) => {
          const result = await query(text, values);
          if (
            !synchronized &&
            text.includes("SELECT id, version, record") &&
            text.includes("FROM papot_clients")
          ) {
            synchronized = true;
            await waitAtSnapshot();
          }
          return result;
        },
        release: () => client.release(),
      } as unknown as PoolClient;
    },
  } as unknown as Pool;
}

describeWithPostgres("Clients PostgreSQL concurrency", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE papot_clients");
  });

  afterAll(async () => {
    await pool.query("TRUNCATE TABLE papot_clients");
    await closeServerDbPool();
  });

  it("rejects one of two simultaneous edits of the same client without silent overwrite", async () => {
    const seedRepository = createPostgresClientsRepository(pool);
    const input = clientInput(
      "33333333-3333-4333-8333-333333333333",
      "Client original",
      "12345678901234",
    );
    await seedRepository.mutate(input, actorA);

    const connectionIds = new Set<number>();
    const waitAtSnapshot = createTwoPartyBarrier();
    const synchronizedPool = createSnapshotSynchronizedPool(pool, waitAtSnapshot, connectionIds);
    const repositoryA = createPostgresClientsRepository(synchronizedPool);
    const repositoryB = createPostgresClientsRepository(synchronizedPool);

    const results = await Promise.allSettled([
      repositoryA.mutate({ ...input, action: "update", companyName: "Version poste A" }, actorA),
      repositoryB.mutate({ ...input, action: "update", companyName: "Version poste B" }, actorB),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(connectionIds.size).toBe(2);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ClientsRepositoryError);
    expect((rejected[0]?.reason as Error).message).toBe("CLIENTS_VERSION_CONFLICT");

    const row = await pool.query<{ version: number; company_name: string }>(
      "SELECT version, record->>'companyName' AS company_name FROM papot_clients WHERE id = $1",
      [input.clientId],
    );

    expect(row.rows[0]?.version).toBe(2);
    expect(["Version poste A", "Version poste B"]).toContain(row.rows[0]?.company_name);
  });

  it("allows two simultaneous edits when they target different clients", async () => {
    const seedRepository = createPostgresClientsRepository(pool);
    const inputA = clientInput(
      "44444444-4444-4444-8444-444444444444",
      "Client A",
      "12345678901234",
    );
    const inputB = clientInput(
      "55555555-5555-4555-8555-555555555555",
      "Client B",
      "98765432109876",
    );
    await seedRepository.mutate(inputA, actorA);
    await seedRepository.mutate(inputB, actorB);

    const connectionIds = new Set<number>();
    const waitAtSnapshot = createTwoPartyBarrier();
    const synchronizedPool = createSnapshotSynchronizedPool(pool, waitAtSnapshot, connectionIds);
    const repositoryA = createPostgresClientsRepository(synchronizedPool);
    const repositoryB = createPostgresClientsRepository(synchronizedPool);

    const [resultA, resultB] = await Promise.all([
      repositoryA.mutate({ ...inputA, action: "update", companyName: "Client A modifié" }, actorA),
      repositoryB.mutate({ ...inputB, action: "update", companyName: "Client B modifié" }, actorB),
    ]);

    expect(connectionIds.size).toBe(2);
    expect(resultA.focusClientId).toBe(inputA.clientId);
    expect(resultB.focusClientId).toBe(inputB.clientId);

    const rows = await pool.query<{ id: string; version: number; company_name: string }>(
      "SELECT id, version, record->>'companyName' AS company_name FROM papot_clients ORDER BY id",
    );

    expect(rows.rows).toEqual([
      { id: inputA.clientId, version: 2, company_name: "Client A modifié" },
      { id: inputB.clientId, version: 2, company_name: "Client B modifié" },
    ]);
  });
});
