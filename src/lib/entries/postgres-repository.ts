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

async function loadState(queryable: Queryable): Promise<EntriesStateRow> {
  const result = await queryable.query<EntriesStateRow>(
    "SELECT version, payload FROM papot_entries_state WHERE scope = 'global'",
  );
  const row = result.rows[0];
  if (!row) throw new Error("ENTRIES_STORAGE_NOT_INITIALIZED");
  return row;
}

export function createPostgresEntriesRepository(pool: Pool = getServerDbPool()): EntriesRepository {
  async function persist(
    transform: (payload: EntriesPayload) => EntriesMutationResult,
  ): Promise<EntriesMutationResult> {
    return withServerDbTransaction(async (client) => {
      const locked = await client.query<EntriesStateRow>(
        `
          SELECT version, payload
          FROM papot_entries_state
          WHERE scope = 'global'
          FOR UPDATE
        `,
      );
      const row = locked.rows[0];
      if (!row) throw new Error("ENTRIES_STORAGE_NOT_INITIALIZED");

      const mutation = transform(parseEntriesPayload(row.payload));
      const saved = await client.query<{ payload: unknown }>(
        `
          UPDATE papot_entries_state
          SET version = version + 1,
              payload = $1,
              updated_at = NOW()
          WHERE scope = 'global' AND version = $2
          RETURNING payload
        `,
        [mutation.payload, row.version],
      );
      if (saved.rowCount === 0) throw new Error("ENTRIES_VERSION_CONFLICT");

      return {
        payload: parseEntriesPayload(saved.rows[0]?.payload),
        focusEntryId: mutation.focusEntryId,
      };
    }, pool);
  }

  return {
    async load() {
      const row = await loadState(pool);
      return parseEntriesPayload(row.payload);
    },
    async mutate(input, actor) {
      return persist((payload) => applyEntriesMutation(payload, input, actor));
    },
    async registerAttachments(entryId, attachments, actor) {
      return persist((payload) => registerEntryAttachments(payload, entryId, attachments, actor));
    },
  };
}
