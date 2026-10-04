import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { effectiveModulePermissions } from "@/lib/auth/effective-module-permissions";
import { hashPassword } from "@/lib/auth/password";
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
  displayName: string;
  email: string;
  isActive: boolean;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
  modulePermissions: Record<string, AccessLevel>;
  specialPermissions: string[];
  sessions: AdminUserSession[];
  revision: string;
};

export async function requirePermissionAdministrator(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  if (!user.canManagePermissions) throw new Error("ADMIN_FORBIDDEN");
  return user;
}

function managedUserRevision(user: {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
  modulePermissions: Record<string, AccessLevel>;
  specialPermissions: string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        isActive: user.isActive,
        canManagePermissions: user.canManagePermissions,
        mustChangePassword: user.mustChangePassword,
        modulePermissions: Object.entries(user.modulePermissions).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        specialPermissions: [...user.specialPermissions].sort(),
      }),
    )
    .digest("hex");
}

function assertManagedUserRevision(
  user: Parameters<typeof managedUserRevision>[0],
  expectedRevision?: string,
): void {
  if (expectedRevision !== undefined && managedUserRevision(user) !== expectedRevision) {
    throw new Error("USER_VERSION_CONFLICT");
  }
}

export function userAdminErrorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED" || code === "ADMIN_FORBIDDEN") return 403;
  if (code === "USER_NOT_FOUND") return 404;
  if (
    code === "USER_EMAIL_EXISTS" ||
    code === "CANNOT_DISABLE_SELF" ||
    code === "USER_VERSION_CONFLICT"
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

export async function listAdminUsers(): Promise<AdminUserSnapshot[]> {
  const payload = await readAuthPayload();
  return [...payload.users]
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" });
    })
    .map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      isActive: user.isActive,
      canManagePermissions: user.canManagePermissions,
      mustChangePassword: user.mustChangePassword,
      modulePermissions: effectiveModulePermissions(user),
      specialPermissions: [...user.specialPermissions].sort(),
      revision: managedUserRevision(user),
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
  displayName: string;
  email: string;
  temporaryPassword: string;
}) {
  const id = randomUUID();
  const passwordHash = await hashPassword(input.temporaryPassword);
  const email = input.email.trim().toLowerCase();
  const actor = await requirePermissionAdministrator();

  await mutateAuthPayload(actor.id, (payload) => {
    assertEmailAvailable(payload.users, email);
    payload.users.push({
      id,
      displayName: input.displayName.trim(),
      email,
      passwordHash,
      isActive: true,
      canManagePermissions: false,
      mustChangePassword: true,
      accentKey: "lavender",
      modulePermissions: {},
      specialPermissions: [],
    });
  });
  return id;
}

export async function updateManagedUserProfile(input: {
  userId: string;
  displayName: string;
  email: string;
  expectedRevision?: string;
}) {
  const actor = await requirePermissionAdministrator();
  const email = input.email.trim().toLowerCase();
  await mutateAuthPayload(actor.id, (payload) => {
    assertEmailAvailable(payload.users, email, input.userId);
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    assertManagedUserRevision(user, input.expectedRevision);
    user.displayName = input.displayName.trim();
    user.email = email;
  });
}

export async function setManagedUserActive(input: {
  userId: string;
  isActive: boolean;
  actorUserId: string;
  expectedRevision?: string;
}) {
  if (!input.isActive && input.userId === input.actorUserId) throw new Error("CANNOT_DISABLE_SELF");
  await mutateAuthPayload(input.actorUserId, (payload) => {
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    assertManagedUserRevision(user, input.expectedRevision);
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
  expectedRevision?: string;
}) {
  const actor = await requirePermissionAdministrator();
  await mutateAuthPayload(actor.id, (payload) => {
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    assertManagedUserRevision(user, input.expectedRevision);
    user.modulePermissions = Object.fromEntries(
      input.modules.map((permission) => [permission.moduleKey, permission.accessLevel]),
    );
    user.specialPermissions = [...new Set(input.specialPermissions)];
  });
}

export async function resetManagedUserPassword(input: {
  userId: string;
  temporaryPassword: string;
}) {
  const actor = await requirePermissionAdministrator();
  const passwordHash = await hashPassword(input.temporaryPassword);
  await mutateAuthPayload(actor.id, (payload) => {
    const user = payload.users.find((candidate) => candidate.id === input.userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    user.passwordHash = passwordHash;
    user.mustChangePassword = true;
    payload.sessions = payload.sessions.filter((session) => session.userId !== input.userId);
  });
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
