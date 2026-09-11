import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/pool";

const cookieName = process.env.SESSION_COOKIE_NAME ?? "papot_session";
const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? "12");

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string;
  accentKey: string;
  canManagePermissions: boolean;
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await db.query(
    "INSERT INTO app_session(token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash(token), userId, expiresAt],
  );

  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (token) {
    await db.query("DELETE FROM app_session WHERE token_hash = $1", [tokenHash(token)]);
  }
  store.delete(cookieName);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;

  const result = await db.query<{
    id: string;
    display_name: string;
    email: string;
    accent_key: string;
    can_manage_permissions: boolean;
  }>(
    `SELECT u.id, u.display_name, u.email, u.accent_key, u.can_manage_permissions
     FROM app_session s
     JOIN app_user u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true`,
    [tokenHash(token)],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    accentKey: row.accent_key,
    canManagePermissions: row.can_manage_permissions,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user as CurrentUser;
}
