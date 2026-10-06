import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import { hashPassword } from "./password";
import { mutateAuthPayload, readAuthPayload } from "./store";

type SetupPurpose = "first_setup" | "admin_reset";

type LocalToken = {
  userId: string;
  tokenHash: string;
  purpose: SetupPurpose;
  createdByUserId: string | null;
  expiresAt: number;
  used: boolean;
};

const localTokens = new Map<string, LocalToken>();

export function passwordSetupTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newPasswordSetupToken(ttlMinutes = 60) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: passwordSetupTokenHash(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  };
}

export async function createPasswordSetupToken(input: {
  userId: string;
  tokenHash: string;
  purpose: SetupPurpose;
  createdByUserId?: string | null;
  expiresAt: Date;
}): Promise<void> {
  if (isLocalStorageMode()) {
    for (const value of localTokens.values()) {
      if (value.userId === input.userId && !value.used) value.used = true;
    }
    localTokens.set(input.tokenHash, {
      userId: input.userId,
      tokenHash: input.tokenHash,
      purpose: input.purpose,
      createdByUserId: input.createdByUserId ?? null,
      expiresAt: input.expiresAt.getTime(),
      used: false,
    });
    await mutateAuthPayload(input.createdByUserId ?? input.userId, (payload) => {
      const user = payload.users.find((candidate) => candidate.id === input.userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      user.mustChangePassword = true;
      payload.sessions = payload.sessions.filter((session) => session.userId !== input.userId);
    });
    return;
  }

  await runServerDbMigrations();
  await withServerDbTransaction(async (client) => {
    await client.query(
      `UPDATE papot_auth_password_setup_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [input.userId],
    );
    await client.query(
      `INSERT INTO papot_auth_password_setup_tokens
       (id, user_id, token_hash, purpose, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        input.userId,
        input.tokenHash,
        input.purpose,
        input.createdByUserId ?? null,
        input.expiresAt,
      ],
    );
    await client.query("DELETE FROM papot_auth_sessions WHERE user_id = $1", [input.userId]);
    const updated = await client.query(
      "UPDATE papot_auth_users SET must_change_password = TRUE WHERE id = $1",
      [input.userId],
    );
    if (updated.rowCount !== 1) throw new Error("USER_NOT_FOUND");
  });
}

export async function consumePasswordSetupToken(input: {
  tokenHash: string;
  password: string;
}): Promise<{ userId: string; username: string } | null> {
  const passwordHash = await hashPassword(input.password);

  if (isLocalStorageMode()) {
    const token = localTokens.get(input.tokenHash);
    if (!token || token.used || token.expiresAt <= Date.now()) return null;
    const payload = await readAuthPayload();
    const existing = payload.users.find(
      (candidate) => candidate.id === token.userId && candidate.isActive,
    );
    if (!existing) return null;
    token.used = true;
    for (const value of localTokens.values()) {
      if (value.userId === token.userId) value.used = true;
    }
    await mutateAuthPayload(token.userId, (draft) => {
      const user = draft.users.find((candidate) => candidate.id === token.userId);
      if (!user || !user.isActive) throw new Error("AUTH_USER_NOT_FOUND");
      user.passwordHash = passwordHash;
      user.mustChangePassword = false;
      draft.sessions = draft.sessions.filter((session) => session.userId !== token.userId);
    });
    return { userId: existing.id, username: existing.username };
  }

  await runServerDbMigrations();
  return withServerDbTransaction(async (client) => {
    const result = await client.query<{
      user_id: string;
      username: string;
    }>(
      `SELECT token.user_id, users.username
       FROM papot_auth_password_setup_tokens AS token
       INNER JOIN papot_auth_users AS users ON users.id = token.user_id
       WHERE token.token_hash = $1
         AND token.used_at IS NULL
         AND token.expires_at > NOW()
         AND users.is_active = TRUE
       FOR UPDATE`,
      [input.tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;

    await client.query(
      `UPDATE papot_auth_users
       SET password_hash = $2, must_change_password = FALSE
       WHERE id = $1`,
      [row.user_id, passwordHash],
    );
    await client.query(
      `UPDATE papot_auth_password_setup_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [row.user_id],
    );
    await client.query("DELETE FROM papot_auth_sessions WHERE user_id = $1", [row.user_id]);
    return { userId: row.user_id, username: row.username };
  });
}
