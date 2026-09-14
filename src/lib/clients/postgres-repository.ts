import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseClientsPayload, type ClientRecord, type ClientsPayload } from "./domain";
import { applyClientsMutation } from "./mutations";
import { ClientsRepositoryError, type ClientsRepository } from "./repository";

const CLIENTS_ORDER_LOCK_ID = 7_332_170_416_238_504;

type ClientRow = {
  id: string;
  version: number;
  record: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type PostgresError = Error & {
  code?: string;
  constraint?: string;
};

async function loadRows(queryable: Queryable): Promise<ClientRow[]> {
  const result = await queryable.query<ClientRow>(`
    SELECT id, version, record
    FROM papot_clients
    ORDER BY sort_order ASC, id ASC
  `);
  return result.rows;
}

function rowsToPayload(rows: ClientRow[]): ClientsPayload {
  return parseClientsPayload({
    schemaVersion: 1,
    clients: rows.map((row) => row.record),
  });
}

function databaseSiret(record: ClientRecord): string | null {
  return record.siret || null;
}

function findMutationRecord(payload: ClientsPayload, clientId: string): ClientRecord {
  const record = payload.clients.find((client) => client.id === clientId);
  if (!record) throw new Error("CLIENT_NOT_FOUND");
  return record;
}

function throwMappedPostgresError(error: unknown): never {
  const postgresError = error as PostgresError;
  if (postgresError.code === "23505" && postgresError.constraint === "papot_clients_siret_unique") {
    throw new Error("CLIENT_SIRET_EXISTS");
  }
  if (postgresError.code === "23505" && postgresError.constraint === "papot_clients_pkey") {
    throw new ClientsRepositoryError("CLIENTS_VERSION_CONFLICT");
  }
  throw error;
}

export function createPostgresClientsRepository(
  pool: Pool = getServerDbPool(),
): ClientsRepository {
  return {
    async load() {
      return rowsToPayload(await loadRows(pool));
    },

    async mutate(input, actor) {
      return withServerDbTransaction(async (client) => {
        const rows = await loadRows(client);
        const source = rowsToPayload(rows);
        const versions = new Map(rows.map((row) => [row.id, row.version]));
        const mutation = applyClientsMutation(source, input, actor);
        const clientId = mutation.focusClientId;

        if (!clientId) throw new Error("CLIENT_MUTATION_RESULT_INVALID");
        const record = findMutationRecord(mutation.payload, clientId);

        if (input.action === "create") {
          await client.query("SELECT pg_advisory_xact_lock($1)", [CLIENTS_ORDER_LOCK_ID]);
          const orderResult = await client.query<{ minimum: string | null }>(
            "SELECT MIN(sort_order)::text AS minimum FROM papot_clients",
          );
          const minimum = orderResult.rows[0]?.minimum;
          const sortOrder = minimum == null ? -1n : BigInt(minimum) - 1n;

          try {
            await client.query(
              `
                INSERT INTO papot_clients (
                  id,
                  version,
                  siret,
                  sort_order,
                  record,
                  created_at,
                  updated_at
                )
                VALUES ($1, 1, $2, $3, $4, $5, $6)
              `,
              [
                record.id,
                databaseSiret(record),
                sortOrder.toString(),
                record,
                record.createdAt,
                record.updatedAt,
              ],
            );
          } catch (error) {
            throwMappedPostgresError(error);
          }

          return mutation;
        }

        const expectedVersion = versions.get(clientId);
        if (expectedVersion == null) throw new Error("CLIENT_NOT_FOUND");

        try {
          const updateResult = await client.query(
            `
              UPDATE papot_clients
              SET version = version + 1,
                  siret = $2,
                  record = $3,
                  updated_at = $4
              WHERE id = $1 AND version = $5
            `,
            [record.id, databaseSiret(record), record, record.updatedAt, expectedVersion],
          );

          if (updateResult.rowCount === 0) {
            throw new ClientsRepositoryError("CLIENTS_VERSION_CONFLICT");
          }
        } catch (error) {
          if (error instanceof ClientsRepositoryError) throw error;
          throwMappedPostgresError(error);
        }

        return mutation;
      }, pool);
    },
  };
}
