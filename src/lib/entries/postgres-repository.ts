import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseEntriesPayload, type EntriesPayload } from "./domain";
import {
  applyEntriesMutation,
  registerEntryAttachments,
  type EntriesMutationResult,
} from "./mutations";
import type { EntriesRepository } from "./repository";

type EntriesStateRow = {
  version: number;
  payload: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function loadState(sourceRequete: Queryable): Promise<EntriesStateRow> {
  const resultat = await sourceRequete.query<EntriesStateRow>(
    "SELECT version, payload FROM papot_entries_state WHERE scope = 'global'",
  );
  const ligne = resultat.rows[0];
  if (!ligne) throw new Error("ENTRIES_STORAGE_NOT_INITIALIZED");
  return ligne;
}

export function createPostgresEntriesRepository(pool: Pool = getServerDbPool()): EntriesRepository {
  async function enregistrer(
    transformation: (donnees: EntriesPayload) => EntriesMutationResult,
  ): Promise<EntriesMutationResult> {
    return withServerDbTransaction(async (client) => {
      const verrouillage = await client.query<EntriesStateRow>(
        `
          SELECT version, payload
          FROM papot_entries_state
          WHERE scope = 'global'
          FOR UPDATE
        `,
      );
      const ligne = verrouillage.rows[0];
      if (!ligne) throw new Error("ENTRIES_STORAGE_NOT_INITIALIZED");

      const mutation = transformation(parseEntriesPayload(ligne.payload));
      const sauvegarde = await client.query<{ payload: unknown }>(
        `
          UPDATE papot_entries_state
          SET version = version + 1,
              payload = $1,
              updated_at = NOW()
          WHERE scope = 'global' AND version = $2
          RETURNING payload
        `,
        [mutation.payload, ligne.version],
      );
      if (sauvegarde.rowCount === 0) {
        throw new Error("ENTRIES_VERSION_CONFLICT");
      }

      return {
        payload: parseEntriesPayload(sauvegarde.rows[0]?.payload),
        focusEntryId: mutation.focusEntryId,
      };
    }, pool);
  }

  return {
    async load() {
      const ligne = await loadState(pool);
      return parseEntriesPayload(ligne.payload);
    },
    async mutate(saisie, auteur) {
      return enregistrer((donnees) => applyEntriesMutation(donnees, saisie, auteur));
    },
    async registerAttachments(idEntree, piecesJointes, auteur) {
      return enregistrer((donnees) =>
        registerEntryAttachments(donnees, idEntree, piecesJointes, auteur),
      );
    },
  };
}
