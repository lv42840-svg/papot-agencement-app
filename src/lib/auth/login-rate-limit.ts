import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import type { QueryResultRow } from "pg";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import {
  emptyLoginState,
  failedLogin,
  loginBlock,
  LOGIN_IP_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  type LoginState,
} from "./login-policy";
import { hashPassword, verifyPassword } from "./password";
import { readAuthPayload } from "./store";
import { newSessionToken } from "./session-token";

export type LoginResult =
  | {
      state: "authenticated";
      userId: string;
      token?: string;
      expiresAt?: Date;
    }
  | {
      state: "invalid" | "temporary" | "admin_reset_required";
      retryAfter: number;
    };

type AccountRow = QueryResultRow & {
  failures: number;
  first_failure_at: Date | null;
  blocked_until: Date | null;
  lock_cycles: number;
  requires_admin_reset: boolean;
};

type UserRow = QueryResultRow & {
  id: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
};

const localAccountStates = new Map<string, LoginState>();
const localIpAttempts = new Map<string, { attempts: number; startedAt: number }>();
let dummyHash: Promise<string> | null = null;

function keyHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function loginAccountKey(username: string): string {
  return username.trim().toLowerCase();
}

export function loginClientIp(request: Request): string {
  if (process.env.PAPOT_TRUST_PROXY_HEADERS !== "true") return "unknown";
  const value = request.headers.get("x-papot-client-ip")?.trim() ?? "";
  if (!isIP(value)) return "unknown";
  if (value.toLowerCase().startsWith("::ffff:") && isIP(value.slice(7)) === 4)
    return value.slice(7);
  if (isIP(value) === 6) return new URL(`http://[${value}]/`).hostname;
  return value;
}

function fromRow(row: AccountRow): LoginState {
  return {
    failures: row.failures,
    firstFailureAt: row.first_failure_at?.getTime() ?? null,
    blockedUntil: row.blocked_until?.getTime() ?? null,
    lockCycles: row.lock_cycles,
    requiresAdminReset: row.requires_admin_reset,
  };
}

async function authenticateLocal(input: {
  username: string;
  password: string;
  request: Request;
}): Promise<LoginResult> {
  const now = Date.now();
  const ipKey = keyHash(loginClientIp(input.request));
  const bucket = localIpAttempts.get(ipKey);
  const currentBucket =
    !bucket || now - bucket.startedAt >= LOGIN_WINDOW_MS
      ? { attempts: 1, startedAt: now }
      : { attempts: bucket.attempts + 1, startedAt: bucket.startedAt };
  localIpAttempts.set(ipKey, currentBucket);
  if (currentBucket.attempts > LOGIN_IP_MAX_ATTEMPTS) {
    return {
      state: "temporary",
      retryAfter: Math.max(1, Math.ceil((currentBucket.startedAt + LOGIN_WINDOW_MS - now) / 1000)),
    };
  }

  const key = loginAccountKey(input.username);
  const state = localAccountStates.get(key) ?? emptyLoginState();
  const block = loginBlock(state, now);
  if (block !== "allowed") {
    return {
      state: block,
      retryAfter: Math.max(1, Math.ceil(((state.blockedUntil ?? now) - now) / 1000)),
    };
  }

  const payload = await readAuthPayload();
  const user = payload.users.find(
    (candidate) => candidate.isActive && candidate.username.toLowerCase() === key,
  );
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  const verified = await verifyPassword(
    input.password,
    user && !user.mustChangePassword ? user.passwordHash : await dummyHash,
  );
  if (!user || user.mustChangePassword || !verified) {
    const next = failedLogin(state, now);
    localAccountStates.set(key, next);
    const nextBlock = loginBlock(next, now);
    return {
      state: nextBlock === "allowed" ? "invalid" : nextBlock,
      retryAfter: nextBlock === "allowed" ? 0 : LOGIN_WINDOW_MS / 1000,
    };
  }

  localAccountStates.delete(key);
  return { state: "authenticated", userId: user.id };
}

export async function authenticateLogin(input: {
  username: string;
  password: string;
  request: Request;
}): Promise<LoginResult> {
  if (isLocalStorageMode()) return authenticateLocal(input);

  await runServerDbMigrations();
  const accountKey = loginAccountKey(input.username);
  const accountHash = keyHash(accountKey);
  const ipHash = keyHash(loginClientIp(input.request));

  const ip = await getServerDbPool().query<{ attempts: number; retry_after: number }>(
    `INSERT INTO papot_auth_ip_attempts AS bucket
       (ip_hash, attempts, window_started_at)
     VALUES ($1, 1, clock_timestamp())
     ON CONFLICT (ip_hash) DO UPDATE SET
       attempts = CASE
         WHEN bucket.window_started_at <= clock_timestamp() - INTERVAL '15 minutes'
         THEN 1 ELSE LEAST(bucket.attempts + 1, $2 + 1) END,
       window_started_at = CASE
         WHEN bucket.window_started_at <= clock_timestamp() - INTERVAL '15 minutes'
         THEN clock_timestamp() ELSE bucket.window_started_at END
     RETURNING attempts,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM
         (window_started_at + INTERVAL '15 minutes' - clock_timestamp()))))::integer
       AS retry_after`,
    [ipHash, LOGIN_IP_MAX_ATTEMPTS],
  );
  if (ip.rows[0].attempts > LOGIN_IP_MAX_ATTEMPTS) {
    return { state: "temporary", retryAfter: ip.rows[0].retry_after };
  }

  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  const dummy = await dummyHash;

  try {
    return await withServerDbTransaction(async (client): Promise<LoginResult> => {
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '8s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
        `papot-agencement-login:${accountHash}`,
      ]);
      await client.query(
        `INSERT INTO papot_auth_account_lock_state (account_hash)
         VALUES ($1) ON CONFLICT (account_hash) DO NOTHING`,
        [accountHash],
      );
      const locked = await client.query<AccountRow>(
        `SELECT failures, first_failure_at, blocked_until, lock_cycles, requires_admin_reset
         FROM papot_auth_account_lock_state
         WHERE account_hash = $1 FOR UPDATE`,
        [accountHash],
      );
      const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      const now = clock.rows[0].now.getTime();
      const state = fromRow(locked.rows[0]);
      const block = loginBlock(state, now);
      if (block !== "allowed") {
        return {
          state: block,
          retryAfter: Math.max(1, Math.ceil(((state.blockedUntil ?? now) - now) / 1000)),
        };
      }

      const found = await client.query<UserRow>(
        `SELECT id, password_hash, is_active, must_change_password
         FROM papot_auth_users
         WHERE LOWER(username) = LOWER($1)
         FOR UPDATE`,
        [accountKey],
      );
      const row = found.rows[0];
      const eligible = row?.is_active && !row.must_change_password;
      const verified = await verifyPassword(input.password, eligible ? row.password_hash : dummy);
      if (!eligible || !verified) {
        const next = failedLogin(state, now);
        await client.query(
          `UPDATE papot_auth_account_lock_state
           SET failures = $2, first_failure_at = $3, blocked_until = $4,
               lock_cycles = $5, requires_admin_reset = $6, updated_at = clock_timestamp()
           WHERE account_hash = $1`,
          [
            accountHash,
            next.failures,
            next.firstFailureAt === null ? null : new Date(next.firstFailureAt),
            next.blockedUntil === null ? null : new Date(next.blockedUntil),
            next.lockCycles,
            next.requiresAdminReset,
          ],
        );
        const nextBlock = loginBlock(next, now);
        return {
          state: nextBlock === "allowed" ? "invalid" : nextBlock,
          retryAfter: nextBlock === "allowed" ? 0 : LOGIN_WINDOW_MS / 1000,
        };
      }

      const session = newSessionToken();
      await client.query(
        `INSERT INTO papot_auth_sessions
         (id, user_id, token_hash, device_id, device_label, created_at, expires_at)
         VALUES ($1, $2, $3, NULL, NULL, $4, $5)`,
        [randomUUID(), row.id, session.tokenHash, session.createdAt, session.expiresAt],
      );
      await client.query("DELETE FROM papot_auth_account_lock_state WHERE account_hash = $1", [
        accountHash,
      ]);
      return {
        state: "authenticated",
        userId: row.id,
        token: session.token,
        expiresAt: session.expiresAt,
      };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "55P03") {
      return { state: "temporary", retryAfter: 1 };
    }
    throw error;
  }
}

export async function clearAdminResetRequirement(accountKey: string): Promise<void> {
  const key = loginAccountKey(accountKey);
  if (isLocalStorageMode()) {
    localAccountStates.delete(key);
    return;
  }
  await runServerDbMigrations();
  await getServerDbPool().query(
    "DELETE FROM papot_auth_account_lock_state WHERE account_hash = $1",
    [keyHash(key)],
  );
}
