import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseAuthPayload, type AuthPayload } from "./domain";
import type { LockedAuthSnapshot } from "./nextcloud-source";
import {
  loadAuthPayloadFromQueryable,
  replaceAuthSnapshotOnClient,
} from "./postgres-repository";

const AUTH_CUTOVER_DOMAIN = "auth";
const AUTH_CUTOVER_SOURCE = "nextcloud:AUTH/global";
const AUTH_CUTOVER_LOCK_ID = 7_332_170_416_238_505;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

function canonicalAuthPayload(payload: AuthPayload) {
  const parsed = parseAuthPayload(payload);
  return {
    schemaVersion: 1 as const,
    users: [...parsed.users]
      .map((user) => ({
        ...user,
        modulePermissions: Object.fromEntries(
          Object.entries(user.modulePermissions).sort(([left], [right]) => left.localeCompare(right)),
        ),
        specialPermissions: [...user.specialPermissions].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    sessions: [...parsed.sessions].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function authPayloadHash(payload: AuthPayload): string {
  return createHash("sha256").update(JSON.stringify(canonicalAuthPayload(payload))).digest("hex");
}

async function findCutoverMarker(
  queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
): Promise<CutoverMarkerRow | null> {
  const result = await queryable.query<CutoverMarkerRow>(
    `
      SELECT source_hash, record_count
      FROM papot_domain_cutovers
      WHERE domain = $1
    `,
    [AUTH_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

async function validateImportedSnapshot(
  client: PoolClient,
  source: AuthPayload,
  expectedHash: string,
): Promise<void> {
  const imported = await loadAuthPayloadFromQueryable(client);
  if (authPayloadHash(imported) !== expectedHash) {
    throw new Error("AUTH_CUTOVER_VALIDATION_FAILED");
  }

  const expectedCount = source.users.length + source.sessions.length;
  if (imported.users.length + imported.sessions.length !== expectedCount) {
    throw new Error("AUTH_CUTOVER_VALIDATION_FAILED");
  }
}

async function importSnapshot(
  client: PoolClient,
  source: AuthPayload,
  sourceHash: string,
): Promise<void> {
  const counts = await client.query<{ users: string; sessions: string }>(`
    SELECT
      (SELECT COUNT(*)::text FROM papot_auth_users) AS users,
      (SELECT COUNT(*)::text FROM papot_auth_sessions) AS sessions
  `);
  if (counts.rows[0]?.users !== "0" || counts.rows[0]?.sessions !== "0") {
    throw new Error("AUTH_CUTOVER_STATE_INVALID");
  }

  await replaceAuthSnapshotOnClient(client, source);
  await validateImportedSnapshot(client, source, sourceHash);

  await client.query(
    `
      INSERT INTO papot_domain_cutovers (
        domain,
        source,
        source_hash,
        record_count
      )
      VALUES ($1, $2, $3, $4)
    `,
    [AUTH_CUTOVER_DOMAIN, AUTH_CUTOVER_SOURCE, sourceHash, source.users.length + source.sessions.length],
  );
}

export async function ensureAuthPostgresCutover(params: {
  pool?: Pool;
  acquireSource(): Promise<LockedAuthSnapshot>;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  const sourceLock = { current: null as LockedAuthSnapshot | null };

  try {
    await withServerDbTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [AUTH_CUTOVER_LOCK_ID]);
      if (await findCutoverMarker(client)) return;

      sourceLock.current = await params.acquireSource();
      const source = parseAuthPayload(sourceLock.current.payload);
      const sourceHash = authPayloadHash(source);
      await importSnapshot(client, source, sourceHash);
    }, pool);
  } finally {
    const lockedSource = sourceLock.current;
    if (lockedSource) {
      await lockedSource.release().catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "AUTH_CUTOVER_LOCK_RELEASE_FAILED";
        console.error("[PAPOT][Auth] cutover lock release failed", { code });
      });
    }
  }
}
