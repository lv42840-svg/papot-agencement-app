import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/pool";

const cookieName = process.env.SESSION_COOKIE_NAME ?? "papot_session";
const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? "12");

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function desktopDeviceIdentity(): { deviceId: string | null; deviceLabel: string | null } {
  const raw = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!raw) return { deviceId: null, deviceLabel: null };
  try {
    const parsed = JSON.parse(raw) as { device_id?: unknown; device_label?: unknown };
    return {
      deviceId: typeof parsed.device_id === "string" && parsed.device_id ? parsed.device_id : null,
      deviceLabel:
        typeof parsed.device_label === "string" && parsed.device_label ? parsed.device_label : null,
    };
  } catch {
    return { deviceId: null, deviceLabel: null };
  }
}

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string;
  accentKey: string;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const sessionId = randomUUID();
  const device = desktopDeviceIdentity();

  await db.query(
    `INSERT INTO app_session(session_id, token_hash, user_id, expires_at, device_id, device_label)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, tokenHash(token), userId, expiresAt, device.deviceId, device.deviceLabel],
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

export async function destroyAllSessionsForUser(userId: string) {
  await db.query("DELETE FROM app_session WHERE user_id = $1", [userId]);
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
    must_change_password: boolean;
  }>(
    `SELECT u.id, u.display_name, u.email, u.accent_key, u.can_manage_permissions,
            u.must_change_password
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
    mustChangePassword: row.must_change_password,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}
