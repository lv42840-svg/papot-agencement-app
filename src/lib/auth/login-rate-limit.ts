import { lockAuthMutation } from "./transaction-lock";
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

function keyHash(valeur: string): string {
  return createHash("sha256").update(valeur).digest("hex");
}

export function loginAccountKey(username: string): string {
  return username.trim().toLowerCase();
}

export function loginClientIp(requete: Request): string {
  if (process.env.PAPOT_TRUST_PROXY_HEADERS !== "true") return "unknown";
  const valeur = requete.headers.get("x-papot-client-ip")?.trim() ?? "";
  if (!isIP(valeur)) return "unknown";
  if (valeur.toLowerCase().startsWith("::ffff:") && isIP(valeur.slice(7)) === 4)
    return valeur.slice(7);
  if (isIP(valeur) === 6) return new URL(`http://[${valeur}]/`).hostname;
  return valeur;
}

function fromRow(ligneTableau: AccountRow): LoginState {
  return {
    failures: ligneTableau.failures,
    firstFailureAt: ligneTableau.first_failure_at?.getTime() ?? null,
    blockedUntil: ligneTableau.blocked_until?.getTime() ?? null,
    lockCycles: ligneTableau.lock_cycles,
    requiresAdminReset: ligneTableau.requires_admin_reset,
  };
}

async function authenticateLocal(saisie: {
  username: string;
  password: string;
  request: Request;
}): Promise<LoginResult> {
  const maintenant = Date.now();
  const ipKey = keyHash(loginClientIp(saisie.request));
  const bucket = localIpAttempts.get(ipKey);
  const currentBucket =
    !bucket || maintenant - bucket.startedAt >= LOGIN_WINDOW_MS
      ? { attempts: 1, startedAt: maintenant }
      : { attempts: bucket.attempts + 1, startedAt: bucket.startedAt };
  localIpAttempts.set(ipKey, currentBucket);
  if (currentBucket.attempts > LOGIN_IP_MAX_ATTEMPTS) {
    return {
      state: "temporary",
      retryAfter: Math.max(
        1,
        Math.ceil((currentBucket.startedAt + LOGIN_WINDOW_MS - maintenant) / 1000),
      ),
    };
  }

  const cle = loginAccountKey(saisie.username);
  const etat = localAccountStates.get(cle) ?? emptyLoginState();
  const block = loginBlock(etat, maintenant);
  if (block !== "allowed") {
    return {
      state: block,
      retryAfter: Math.max(1, Math.ceil(((etat.blockedUntil ?? maintenant) - maintenant) / 1000)),
    };
  }

  const contenu = await readAuthPayload();
  const utilisateur = contenu.users.find(
    (candidat) => candidat.isActive && candidat.username.toLowerCase() === cle,
  );
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  const verified = await verifyPassword(
    saisie.password,
    utilisateur && !utilisateur.mustChangePassword ? utilisateur.passwordHash : await dummyHash,
  );
  if (!utilisateur || utilisateur.mustChangePassword || !verified) {
    const suivant = failedLogin(etat, maintenant);
    localAccountStates.set(cle, suivant);
    const nextBlock = loginBlock(suivant, maintenant);
    return {
      state: nextBlock === "allowed" ? "invalid" : nextBlock,
      retryAfter: nextBlock === "allowed" ? 0 : LOGIN_WINDOW_MS / 1000,
    };
  }

  localAccountStates.delete(cle);
  return { state: "authenticated", userId: utilisateur.id };
}

export async function authenticateLogin(saisie: {
  username: string;
  password: string;
  request: Request;
}): Promise<LoginResult> {
  if (isLocalStorageMode()) return authenticateLocal(saisie);

  await runServerDbMigrations();
  const accountKey = loginAccountKey(saisie.username);
  const accountHash = keyHash(accountKey);
  const ipHash = keyHash(loginClientIp(saisie.request));

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
      await lockAuthMutation(client);
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
      const maintenant = clock.rows[0].now.getTime();
      const etat = fromRow(locked.rows[0]);
      const block = loginBlock(etat, maintenant);
      if (block !== "allowed") {
        return {
          state: block,
          retryAfter: Math.max(
            1,
            Math.ceil(((etat.blockedUntil ?? maintenant) - maintenant) / 1000),
          ),
        };
      }

      const trouve = await client.query<UserRow>(
        `SELECT id, password_hash, is_active, must_change_password
         FROM papot_auth_users
         WHERE LOWER(username) = LOWER($1)
         FOR UPDATE`,
        [accountKey],
      );
      const ligneTableau = trouve.rows[0];
      const eligible = ligneTableau?.is_active && !ligneTableau.must_change_password;
      const verified = await verifyPassword(
        saisie.password,
        eligible ? ligneTableau.password_hash : dummy,
      );
      if (!eligible || !verified) {
        const suivant = failedLogin(etat, maintenant);
        await client.query(
          `UPDATE papot_auth_account_lock_state
           SET failures = $2, first_failure_at = $3, blocked_until = $4,
               lock_cycles = $5, requires_admin_reset = $6, updated_at = clock_timestamp()
           WHERE account_hash = $1`,
          [
            accountHash,
            suivant.failures,
            suivant.firstFailureAt === null ? null : new Date(suivant.firstFailureAt),
            suivant.blockedUntil === null ? null : new Date(suivant.blockedUntil),
            suivant.lockCycles,
            suivant.requiresAdminReset,
          ],
        );
        const nextBlock = loginBlock(suivant, maintenant);
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
        [randomUUID(), ligneTableau.id, session.tokenHash, session.createdAt, session.expiresAt],
      );
      await client.query("DELETE FROM papot_auth_account_lock_state WHERE account_hash = $1", [
        accountHash,
      ]);
      return {
        state: "authenticated",
        userId: ligneTableau.id,
        token: session.token,
        expiresAt: session.expiresAt,
      };
    });
  } catch (erreur) {
    if (
      typeof erreur === "object" &&
      erreur !== null &&
      "code" in erreur &&
      erreur.code === "55P03"
    ) {
      return { state: "temporary", retryAfter: 1 };
    }
    throw erreur;
  }
}

export async function clearAdminResetRequirement(accountKey: string): Promise<void> {
  const cle = loginAccountKey(accountKey);
  if (isLocalStorageMode()) {
    localAccountStates.delete(cle);
    return;
  }
  await runServerDbMigrations();
  await getServerDbPool().query(
    "DELETE FROM papot_auth_account_lock_state WHERE account_hash = $1",
    [keyHash(cle)],
  );
}

export async function allowPasswordSetupRequest(requete: Request): Promise<boolean> {
  const cle = keyHash("password-setup:" + loginClientIp(requete));
  if (isLocalStorageMode()) {
    const maintenant = Date.now();
    const old = localIpAttempts.get(cle);
    const bucket =
      !old || maintenant - old.startedAt >= LOGIN_WINDOW_MS
        ? { attempts: 0, startedAt: maintenant }
        : old;
    bucket.attempts += 1;
    localIpAttempts.set(cle, bucket);
    return bucket.attempts <= 10;
  }
  await runServerDbMigrations();
  const resultat = await getServerDbPool().query<{ attempts: number }>(
    `
    INSERT INTO papot_auth_ip_attempts AS bucket (ip_hash, attempts, window_started_at)
    VALUES ($1, 1, clock_timestamp())
    ON CONFLICT (ip_hash) DO UPDATE SET
      attempts = CASE WHEN bucket.window_started_at <= clock_timestamp() - INTERVAL '15 minutes' THEN 1 ELSE LEAST(bucket.attempts + 1, 11) END,
      window_started_at = CASE WHEN bucket.window_started_at <= clock_timestamp() - INTERVAL '15 minutes' THEN clock_timestamp() ELSE bucket.window_started_at END
    RETURNING attempts`,
    [cle],
  );
  return resultat.rows[0].attempts <= 10;
}
