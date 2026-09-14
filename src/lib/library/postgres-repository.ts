import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import type { OpenSharedResourceResult } from "../sync/resource-edit-coordinator";
import {
  createResourceLock,
  isResourceLockExpired,
  isResourceLockOwnedBy,
  nextSharedResourceVersion,
  renewResourceLock,
  sharedResourceEnvelopeSchema,
  sharedResourceLockSchema,
  type ResourceLockOwner,
  type SharedResourceEnvelope,
  type SharedResourceLock,
} from "../sync/resource-lock";
import type { SaveSharedResourceResult } from "../sync/resource-state-store";
import type { LibraryRepository } from "./repository";
import { LIBRARY_RESOURCE_REF, parseLibraryPayload, type LibrarySnapshot } from "./storage";

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

function isoDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function envelopeFromRow(row: LibraryStateRow): SharedResourceEnvelope {
  return sharedResourceEnvelopeSchema.parse({
    schema_version: 1,
    resource: LIBRARY_RESOURCE_REF,
    version: row.version,
    updated_at: isoDate(row.updated_at),
    updated_by_user_id: row.updated_by_user_id,
    updated_by_device_id: row.updated_by_device_id,
    payload: parseLibraryPayload(row.payload),
  });
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

async function loadLock(client: PoolClient): Promise<SharedResourceLock | null> {
  const result = await client.query<LibraryLockRow>(
    `
      SELECT lock_data
      FROM papot_library_edit_lock
      WHERE scope = 'catalog'
      FOR UPDATE
    `,
  );
  const row = result.rows[0];
  return row ? sharedResourceLockSchema.parse(row.lock_data) : null;
}

async function storeLock(client: PoolClient, lock: SharedResourceLock): Promise<void> {
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
  owner: ResourceLockOwner,
  pool: Pool = getServerDbPool(),
  options: RepositoryOptions = {},
): LibraryRepository {
  const clock = options.now ?? (() => new Date());

  return {
    async load(): Promise<LibrarySnapshot> {
      return snapshotFromRow(await loadState(pool));
    },

    async open(leaseId: string): Promise<OpenSharedResourceResult> {
      return withServerDbTransaction(async (client) => {
        const state = await loadState(client, true);
        const resource = envelopeFromRow(state);
        const now = clock();
        let currentLock = await loadLock(client);

        if (currentLock && isResourceLockExpired(currentLock, now)) {
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

        const lock = createResourceLock({
          resource: LIBRARY_RESOURCE_REF,
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

    async save(input): Promise<SaveSharedResourceResult> {
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
        throw new Error("EXPECTED_VERSION_INVALID");
      }
      const payload = parseLibraryPayload(input.payload);

      return withServerDbTransaction(async (client) => {
        const state = await loadState(client, true);
        const currentLock = await loadLock(client);
        if (!currentLock) throw new Error("LOCK_NOT_FOUND");

        const now = clock();
        const renewed = renewResourceLock({
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

        const nextVersion = nextSharedResourceVersion(state.version);
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

    async renew(leaseId: string): Promise<SharedResourceLock> {
      return withServerDbTransaction(async (client) => {
        const currentLock = await loadLock(client);
        if (!currentLock) throw new Error("LOCK_NOT_FOUND");

        const renewed = renewResourceLock({
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
        if (!isResourceLockOwnedBy(currentLock, leaseId, owner)) {
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
