import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { mutateAuthPayload, readAuthPayload } from "@/lib/auth/store";

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
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const device = desktopDeviceIdentity();

  await mutateAuthPayload(userId, (payload) => {
    const user = payload.users.find((candidate) => candidate.id === userId && candidate.isActive);
    if (!user) throw new Error("AUTH_USER_NOT_FOUND");
    payload.sessions.push({
      id: randomUUID(),
      tokenHash: tokenHash(token),
      userId,
      deviceId: device.deviceId,
      deviceLabel: device.deviceLabel,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  });

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
    const hash = tokenHash(token);
    const payload = await readAuthPayload();
    const session = payload.sessions.find((candidate) => candidate.tokenHash === hash);
    if (session) {
      await mutateAuthPayload(session.userId, (draft) => {
        draft.sessions = draft.sessions.filter((candidate) => candidate.tokenHash !== hash);
      });
    }
  }
  store.delete(cookieName);
}

export async function destroyAllSessionsForUser(userId: string) {
  await mutateAuthPayload(userId, (payload) => {
    payload.sessions = payload.sessions.filter((session) => session.userId !== userId);
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;

  const hash = tokenHash(token);
  const payload = await readAuthPayload();
  const session = payload.sessions.find((candidate) => candidate.tokenHash === hash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;

  const user = payload.users.find((candidate) => candidate.id === session.userId && candidate.isActive);
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    accentKey: user.accentKey,
    canManagePermissions: user.canManagePermissions,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}
