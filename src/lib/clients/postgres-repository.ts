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

async function loadRows(sourceRequete: Queryable): Promise<ClientRow[]> {
  const resultat = await sourceRequete.query<ClientRow>(`
    SELECT id, version, record
    FROM papot_clients
    ORDER BY sort_order ASC, id ASC
  `);
  return resultat.rows;
}

function rowsToPayload(lignes: ClientRow[]): ClientsPayload {
  return parseClientsPayload({
    schemaVersion: 1,
    clients: lignes.map((ligne) => ligne.record),
  });
}

function databaseSiret(enregistrement: ClientRecord): string | null {
  return enregistrement.siret || null;
}

function findMutationRecord(donnees: ClientsPayload, idClient: string): ClientRecord {
  const enregistrement = donnees.clients.find((client) => client.id === idClient);
  if (!enregistrement) {
    throw new Error("CLIENT_NOT_FOUND");
  }
  return enregistrement;
}

function throwMappedPostgresError(erreur: unknown): never {
  const erreurPostgres = erreur as PostgresError;
  if (
    erreurPostgres.code === "23505" &&
    erreurPostgres.constraint === "papot_clients_siret_unique"
  ) {
    throw new Error("CLIENT_SIRET_EXISTS");
  }
  if (erreurPostgres.code === "23505" && erreurPostgres.constraint === "papot_clients_pkey") {
    throw new ClientsRepositoryError("CLIENTS_VERSION_CONFLICT");
  }
  throw erreur;
}

export function createPostgresClientsRepository(pool: Pool = getServerDbPool()): ClientsRepository {
  return {
    async load() {
      return rowsToPayload(await loadRows(pool));
    },

    async mutate(saisie, auteur) {
      return withServerDbTransaction(async (client) => {
        const lignes = await loadRows(client);
        const source = rowsToPayload(lignes);
        const versions = new Map(lignes.map((ligne) => [ligne.id, ligne.version]));
        const mutation = applyClientsMutation(source, saisie, auteur);
        const idClient = mutation.focusClientId;

        if (!idClient) {
          throw new Error("CLIENT_MUTATION_RESULT_INVALID");
        }
        const enregistrement = findMutationRecord(mutation.payload, idClient);

        if (saisie.action === "create") {
          await client.query("SELECT pg_advisory_xact_lock($1)", [CLIENTS_ORDER_LOCK_ID]);
          const resultatOrdre = await client.query<{
            minimum: string | null;
          }>("SELECT MIN(sort_order)::text AS minimum FROM papot_clients");
          const minimum = resultatOrdre.rows[0]?.minimum;
          const ordreTri = minimum == null ? -1n : BigInt(minimum) - 1n;

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
                enregistrement.id,
                databaseSiret(enregistrement),
                ordreTri.toString(),
                enregistrement,
                enregistrement.createdAt,
                enregistrement.updatedAt,
              ],
            );
          } catch (erreur) {
            throwMappedPostgresError(erreur);
          }

          return mutation;
        }

        const versionAttendue = versions.get(idClient);
        if (versionAttendue == null) {
          throw new Error("CLIENT_NOT_FOUND");
        }

        try {
          const resultatMiseAJour = await client.query(
            `
              UPDATE papot_clients
              SET version = version + 1,
                  siret = $2,
                  record = $3,
                  updated_at = $4
              WHERE id = $1 AND version = $5
            `,
            [
              enregistrement.id,
              databaseSiret(enregistrement),
              enregistrement,
              enregistrement.updatedAt,
              versionAttendue,
            ],
          );

          if (resultatMiseAJour.rowCount === 0) {
            throw new ClientsRepositoryError("CLIENTS_VERSION_CONFLICT");
          }
        } catch (erreur) {
          if (erreur instanceof ClientsRepositoryError) {
            throw erreur;
          }
          throwMappedPostgresError(erreur);
        }

        return mutation;
      }, pool);
    },
  };
}
