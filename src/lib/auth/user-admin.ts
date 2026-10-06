import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import {
  createPasswordSetupToken,
  newPasswordSetupToken,
} from "@/lib/auth/password-setup";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import type { AccessLevel } from "@/lib/auth/permissions";
import { mutateAuthPayload, readAuthPayload } from "@/lib/auth/store";

export type AdminUserSession = {
  id: string;
  deviceId: string | null;
  deviceLabel: string | null;
  createdAt: string;
  expiresAt: string;
};

export type AdminUserSnapshot = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  isActive: boolean;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
  modulePermissions: Record<string, AccessLevel>;
  specialPermissions: string[];
  sessions: AdminUserSession[];
};

export async function requirePermissionAdministrator(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  if (!user.canManagePermissions) throw new Error("ADMIN_FORBIDDEN");
  return user;
}

export function userAdminErrorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED" || code === "ADMIN_FORBIDDEN") return 403;
  if (code === "USER_NOT_FOUND") return 404;
  if (
    code === "USER_EMAIL_EXISTS" ||
    code === "USERNAME_ALREADY_EXISTS" ||
    code === "CANNOT_DISABLE_SELF"
  )
    return 409;
  return 400;
}

function assertEmailAvailable(
  users: Array<{ id: string; email: string }>,
  email: string,
  exceptUserId?: string,
) {
  const normalized = email.trim().toLowerCase();
  if (
    users.some((user) => user.id !== exceptUserId && user.email.trim().toLowerCase() === normalized)
  ) {
    throw new Error("USER_EMAIL_EXISTS");
  }
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function assertUsernameAvailable(
  users: Array<{ id: string; username: string }>,
  username: string,
  exceptUserId?: string,
) {
  const normalized = normalizeUsername(username);
  if (users.some((user) => user.id !== exceptUserId && user.username.toLowerCase() === normalized)) {
    throw new Error("USERNAME_ALREADY_EXISTS");
  }
}

export async function listAdminUsers(): Promise<AdminUserSnapshot[]> {
  const payload = await readAuthPayload();
  return [...payload.users]
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" });
    })
    .map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      isActive: user.isActive,
      canManagePermissions: user.canManagePermissions,
      mustChangePassword: user.mustChangePassword,
      modulePermissions: { ...user.modulePermissions },
      specialPermissions: [...user.specialPermissions].sort(),
      sessions: payload.sessions
        .filter((session) => session.userId === user.id)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((session) => ({
          id: session.id,
          deviceId: session.deviceId,
          deviceLabel: session.deviceLabel,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })),
    }));
}

export async function createManagedUser(input: {
  username: string;
  displayName: string;
  email: string;
}) {
  const id = randomUUID();
  const username = normalizeUsername(input.username);
  const email = input.email.trim().toLowerCase();
  const placeholderPasswordHash = await hashPassword(randomBytes(48).toString("base64url"));
  const actor = await requirePermissionAdministrator();

  await mutateAuthPayload(actor.id, (payload) => {
    assertUsernameAvailable(payload.users, username);
    assertEmailAvailable(payload.users, email);
    payload.users.push({
      id,
      username,
      displayName: input.displayName.trim(),
      email,
      passwordHash: placeholderPasswordHash,
      isActive: true,
      canManagePermissions: false,
      mustChangePassword: true,
      accentKey: "lavender",
      modulePermissions: {},
      specialPermissions: [],
    });
  });

  const setup = newPasswordSetupToken(60);
  await createPasswordSetupToken({
    userId: id,
    tokenHash: setup.tokenHash,
    purpose: "first_setup",
    createdByUserId: actor.id,
    expiresAt: setup.expiresAt,
  });
  return {
    id,
    setupUrl: `/setup-password?token=${encodeURIComponent(setup.token)}`,
    expiresAt: setup.expiresAt.toISOString(),
  };
}

export async function updateManagedUserProfile(input: {
  userId: string;
  username: string;
  displayName: string;
  email: string;
}) {
  const actor = await requirePermissionAdministrator();
  const username = normalizeUsername(input.username);
  const email = input.email.trim().toLowerCase();
  await mutateAuthPayload(actor.id, (payload) => {
    assertUsernameAvailable(payload.users, username, input.userId);
    assertEmailAvailable(payload.users, email, input.userId);
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    user.username = username;
    user.displayName = input.displayName.trim();
    user.email = email;
  });
}

export async function setManagedUserActive(input: {
  userId: string;
  isActive: boolean;
  actorUserId: string;
}) {
  if (!input.isActive && input.userId === input.actorUserId) throw new Error("CANNOT_DISABLE_SELF");
  await mutateAuthPayload(input.actorUserId, (payload) => {
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    user.isActive = input.isActive;
    if (!input.isActive) {
      payload.sessions = payload.sessions.filter((session) => session.userId !== input.userId);
    }
  });
}

export async function replaceManagedUserPermissions(input: {
  userId: string;
  modules: Array<{ moduleKey: string; accessLevel: AccessLevel }>;
  specialPermissions: string[];
}) {
  const actor = await requirePermissionAdministrator();
  await mutateAuthPayload(actor.id, (payload) => {
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    user.modulePermissions = Object.fromEntries(
      input.modules.map((permission) => [permission.moduleKey, permission.accessLevel]),
    );
    user.specialPermissions = [...new Set(input.specialPermissions)];
  });
}

export async function resetManagedUserPassword(input: { userId: string }) {
  const actor = await requirePermissionAdministrator();
  const payload = await readAuthPayload();
  const user = payload.users.find((candidate) => candidate.id === input.userId && candidate.isActive);
  if (!user) throw new Error("USER_NOT_FOUND");

  const setup = newPasswordSetupToken(60);
  await createPasswordSetupToken({
    userId: user.id,
    tokenHash: setup.tokenHash,
    purpose: "admin_reset",
    createdByUserId: actor.id,
    expiresAt: setup.expiresAt,
  });
  return {
    setupUrl: `/setup-password?token=${encodeURIComponent(setup.token)}`,
    expiresAt: setup.expiresAt.toISOString(),
  };
}

export async function revokeManagedUserSession(input: { userId: string; sessionId: string }) {
  const actor = await requirePermissionAdministrator();
  await mutateAuthPayload(actor.id, (payload) => {
    if (!payload.users.some((candidate) => candidate.id === input.userId)) {
      throw new Error("USER_NOT_FOUND");
    }
    payload.sessions = payload.sessions.filter(
      (session) => !(session.userId === input.userId && session.id === input.sessionId),
    );
  });
}
