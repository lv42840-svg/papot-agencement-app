import { lockAuthMutation } from "./transaction-lock";
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

export async function createPasswordSetupToken(saisie: {
  userId: string;
  tokenHash: string;
  purpose: SetupPurpose;
  createdByUserId?: string | null;
  expiresAt: Date;
}): Promise<void> {
  if (isLocalStorageMode()) {
    for (const valeur of localTokens.values()) {
      if (valeur.userId === saisie.userId && !valeur.used) valeur.used = true;
    }
    localTokens.set(saisie.tokenHash, {
      userId: saisie.userId,
      tokenHash: saisie.tokenHash,
      purpose: saisie.purpose,
      createdByUserId: saisie.createdByUserId ?? null,
      expiresAt: saisie.expiresAt.getTime(),
      used: false,
    });
    await mutateAuthPayload(saisie.createdByUserId ?? saisie.userId, (contenu) => {
      const utilisateur = contenu.users.find((candidat) => candidat.id === saisie.userId);
      if (!utilisateur) throw new Error("USER_NOT_FOUND");
      utilisateur.mustChangePassword = true;
      contenu.sessions = contenu.sessions.filter((session) => session.userId !== saisie.userId);
    });
    return;
  }

  await runServerDbMigrations();
  await withServerDbTransaction(async (client) => {
    await lockAuthMutation(client);
    await client.query(
      `UPDATE papot_auth_password_setup_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [saisie.userId],
    );
    await client.query(
      `INSERT INTO papot_auth_password_setup_tokens
       (id, user_id, token_hash, purpose, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        saisie.userId,
        saisie.tokenHash,
        saisie.purpose,
        saisie.createdByUserId ?? null,
        saisie.expiresAt,
      ],
    );
    await client.query("DELETE FROM papot_auth_sessions WHERE user_id = $1", [saisie.userId]);
    const updated = await client.query(
      "UPDATE papot_auth_users SET must_change_password = TRUE WHERE id = $1",
      [saisie.userId],
    );
    if (updated.rowCount !== 1) throw new Error("USER_NOT_FOUND");
  });
}

export async function consumePasswordSetupToken(saisie: {
  tokenHash: string;
  password: string;
}): Promise<{ userId: string; username: string } | null> {
  const passwordHash = await hashPassword(saisie.password);

  if (isLocalStorageMode()) {
    const token = localTokens.get(saisie.tokenHash);
    if (!token || token.used || token.expiresAt <= Date.now()) return null;
    const contenu = await readAuthPayload();
    const existing = contenu.users.find(
      (candidat) => candidat.id === token.userId && candidat.isActive,
    );
    if (!existing) return null;
    token.used = true;
    for (const valeur of localTokens.values()) {
      if (valeur.userId === token.userId) valeur.used = true;
    }
    await mutateAuthPayload(token.userId, (brouillon) => {
      const utilisateur = brouillon.users.find((candidat) => candidat.id === token.userId);
      if (!utilisateur || !utilisateur.isActive) throw new Error("AUTH_USER_NOT_FOUND");
      utilisateur.passwordHash = passwordHash;
      utilisateur.mustChangePassword = false;
      brouillon.sessions = brouillon.sessions.filter((session) => session.userId !== token.userId);
    });
    return { userId: existing.id, username: existing.username };
  }

  await runServerDbMigrations();
  return withServerDbTransaction(async (client) => {
    await lockAuthMutation(client);
    const resultat = await client.query<{
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
      [saisie.tokenHash],
    );
    const ligneTableau = resultat.rows[0];
    if (!ligneTableau) return null;

    await client.query(
      `UPDATE papot_auth_users
       SET password_hash = $2, must_change_password = FALSE
       WHERE id = $1`,
      [ligneTableau.user_id, passwordHash],
    );
    await client.query(
      `UPDATE papot_auth_password_setup_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [ligneTableau.user_id],
    );
    await client.query("DELETE FROM papot_auth_sessions WHERE user_id = $1", [
      ligneTableau.user_id,
    ]);
    return { userId: ligneTableau.user_id, username: ligneTableau.username };
  });
}
