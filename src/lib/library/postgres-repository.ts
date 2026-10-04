import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import {
  createLibraryLock,
  isLibraryLockExpired,
  isLibraryLockOwnedBy,
  libraryEditLockSchema,
  renewLibraryLock,
  type LibraryEditLock,
  type LibraryEnvelope,
  type LibraryLockOwner,
  type OpenLibraryResult,
  type SaveLibraryEditResult,
} from "./edit-lock";
import type { LibraryRepository } from "./repository";
import { parseLibraryPayload, type LibrarySnapshot } from "./storage";

type LibraryStateRow = {
  version: number;
  payload: unknown;
  updated_at: Date | string;
  updated_by_user_id: string;
  updated_by_device_id: string;
};

type LibraryLockRow = {
  lock_data: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type RepositoryOptions = {
  now?: () => Date;
  ttlMs?: number;
};

function envelopeFromRow(row: LibraryStateRow): LibraryEnvelope {
  return {
    version: row.version,
    payload: parseLibraryPayload(row.payload),
  };
}

function snapshotFromRow(row: LibraryStateRow): LibrarySnapshot {
  return {
    version: row.version,
    payload: parseLibraryPayload(row.payload),
  };
}

async function loadState(queryable: Queryable, forUpdate = false): Promise<LibraryStateRow> {
  const result = await queryable.query<LibraryStateRow>(
    `
      SELECT version, payload, updated_at, updated_by_user_id, updated_by_device_id
      FROM papot_library_state
      WHERE scope = 'catalog'
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
  );
  const row = result.rows[0];
  if (!row) throw new Error("LIBRARY_STORAGE_NOT_INITIALIZED");
  return row;
}

async function loadLock(client: PoolClient): Promise<LibraryEditLock | null> {
  const result = await client.query<LibraryLockRow>(
    `
      SELECT lock_data
      FROM papot_library_edit_lock
      WHERE scope = 'catalog'
      FOR UPDATE
    `,
  );
  const row = result.rows[0];
  return row ? libraryEditLockSchema.parse(row.lock_data) : null;
}

async function storeLock(client: PoolClient, lock: LibraryEditLock): Promise<void> {
  await client.query(
    `
      INSERT INTO papot_library_edit_lock (scope, lock_data)
      VALUES ('catalog', $1)
      ON CONFLICT (scope) DO UPDATE SET lock_data = EXCLUDED.lock_data
    `,
    [lock],
  );
}

export function createPostgresLibraryRepository(
  owner: LibraryLockOwner,
  pool: Pool = getServerDbPool(),
  options: RepositoryOptions = {},
): LibraryRepository {
  const clock = options.now ?? (() => new Date());

  return {
    async load(): Promise<LibrarySnapshot> {
      return snapshotFromRow(await loadState(pool));
    },

    async open(leaseId: string): Promise<OpenLibraryResult> {
      return withServerDbTransaction(async (client) => {
        const state = await loadState(client, true);
        const resource = envelopeFromRow(state);
        const now = clock();
        let currentLock = await loadLock(client);

        if (currentLock && isLibraryLockExpired(currentLock, now)) {
          await client.query("DELETE FROM papot_library_edit_lock WHERE scope = 'catalog'");
          currentLock = null;
        }

        if (currentLock) {
          return {
            status: "read-only",
            resource,
            lock: currentLock,
            baseVersion: state.version,
          };
        }

        const lock = createLibraryLock({
          leaseId,
          owner,
          baseVersion: state.version,
          now,
          ttlMs: options.ttlMs,
        });
        await storeLock(client, lock);

        return {
          status: "editable",
          resource,
          lock,
          baseVersion: state.version,
        };
      }, pool);
    },

    async save(input): Promise<SaveLibraryEditResult> {
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
        throw new Error("EXPECTED_VERSION_INVALID");
      }
      const payload = parseLibraryPayload(input.payload);

      return withServerDbTransaction(async (client) => {
        const state = await loadState(client, true);
        const currentLock = await loadLock(client);
        if (!currentLock) throw new Error("LOCK_NOT_FOUND");

        const now = clock();
        const renewed = renewLibraryLock({
          current: currentLock,
          leaseId: input.leaseId,
          owner,
          now,
          ttlMs: options.ttlMs,
        });
        await storeLock(client, renewed);

        if (state.version !== input.expectedVersion) {
          return {
            status: "conflict",
            current: envelopeFromRow(state),
          };
        }

        const nextVersion = state.version + 1;
        const saved = await client.query<LibraryStateRow>(
          `
            UPDATE papot_library_state
            SET version = $1,
                payload = $2,
                updated_at = $3,
                updated_by_user_id = $4,
                updated_by_device_id = $5
            WHERE scope = 'catalog'
            RETURNING version, payload, updated_at, updated_by_user_id, updated_by_device_id
          `,
          [nextVersion, payload, now.toISOString(), owner.userId, owner.deviceId],
        );
        const row = saved.rows[0];
        if (!row) throw new Error("LIBRARY_STORAGE_NOT_INITIALIZED");

        return {
          status: "saved",
          resource: envelopeFromRow(row),
        };
      }, pool);
    },

    async renew(leaseId: string): Promise<LibraryEditLock> {
      return withServerDbTransaction(async (client) => {
        const currentLock = await loadLock(client);
        if (!currentLock) throw new Error("LOCK_NOT_FOUND");

        const renewed = renewLibraryLock({
          current: currentLock,
          leaseId,
          owner,
          now: clock(),
          ttlMs: options.ttlMs,
        });
        await storeLock(client, renewed);
        return renewed;
      }, pool);
    },

    async release(leaseId: string): Promise<boolean> {
      return withServerDbTransaction(async (client) => {
        const currentLock = await loadLock(client);
        if (!currentLock) return false;
        if (!isLibraryLockOwnedBy(currentLock, leaseId, owner)) {
          throw new Error("LOCK_NOT_OWNED");
        }

        const deleted = await client.query(
          "DELETE FROM papot_library_edit_lock WHERE scope = 'catalog'",
        );
        return (deleted.rowCount ?? 0) > 0;
      }, pool);
    },
  };
}
