import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { createPasswordSetupToken, newPasswordSetupToken } from "@/lib/auth/password-setup";
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
  const utilisateur = await getCurrentUser();
  if (!utilisateur) throw new Error("AUTH_REQUIRED");
  if (utilisateur.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  if (!utilisateur.canManagePermissions) throw new Error("ADMIN_FORBIDDEN");
  return utilisateur;
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
  utilisateurs: Array<{ id: string; email: string }>,
  email: string,
  exceptUserId?: string,
) {
  const normalized = email.trim().toLowerCase();
  if (
    utilisateurs.some(
      (utilisateur) =>
        utilisateur.id !== exceptUserId && utilisateur.email.trim().toLowerCase() === normalized,
    )
  ) {
    throw new Error("USER_EMAIL_EXISTS");
  }
}

function normalizeUsername(valeur: string): string {
  return valeur.trim().toLowerCase();
}

function assertUsernameAvailable(
  utilisateurs: Array<{ id: string; username: string }>,
  username: string,
  exceptUserId?: string,
) {
  const normalized = normalizeUsername(username);
  if (
    utilisateurs.some(
      (utilisateur) =>
        utilisateur.id !== exceptUserId && utilisateur.username.toLowerCase() === normalized,
    )
  ) {
    throw new Error("USERNAME_ALREADY_EXISTS");
  }
}

export async function listAdminUsers(): Promise<AdminUserSnapshot[]> {
  const contenu = await readAuthPayload();
  return [...contenu.users]
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" });
    })
    .map((utilisateur) => ({
      id: utilisateur.id,
      username: utilisateur.username,
      displayName: utilisateur.displayName,
      email: utilisateur.email,
      isActive: utilisateur.isActive,
      canManagePermissions: utilisateur.canManagePermissions,
      mustChangePassword: utilisateur.mustChangePassword,
      modulePermissions: { ...utilisateur.modulePermissions },
      specialPermissions: [...utilisateur.specialPermissions].sort(),
      sessions: contenu.sessions
        .filter((session) => session.userId === utilisateur.id)
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

export async function createManagedUser(saisie: {
  username: string;
  displayName: string;
  email: string;
}) {
  const id = randomUUID();
  const username = normalizeUsername(saisie.username);
  const email = saisie.email.trim().toLowerCase();
  const placeholderPasswordHash = await hashPassword(randomBytes(48).toString("base64url"));
  const auteur = await requirePermissionAdministrator();

  await mutateAuthPayload(auteur.id, (contenu) => {
    assertUsernameAvailable(contenu.users, username);
    assertEmailAvailable(contenu.users, email);
    contenu.users.push({
      id,
      username,
      displayName: saisie.displayName.trim(),
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
    createdByUserId: auteur.id,
    expiresAt: setup.expiresAt,
  });
  return {
    id,
    setupUrl: `/setup-password?token=${encodeURIComponent(setup.token)}`,
    expiresAt: setup.expiresAt.toISOString(),
  };
}

export async function updateManagedUserProfile(saisie: {
  userId: string;
  username: string;
  displayName: string;
  email: string;
}) {
  const auteur = await requirePermissionAdministrator();
  const username = normalizeUsername(saisie.username);
  const email = saisie.email.trim().toLowerCase();
  await mutateAuthPayload(auteur.id, (contenu) => {
    assertUsernameAvailable(contenu.users, username, saisie.userId);
    assertEmailAvailable(contenu.users, email, saisie.userId);
    const utilisateur = contenu.users.find((candidat) => candidat.id === saisie.userId);
    if (!utilisateur) throw new Error("USER_NOT_FOUND");
    utilisateur.username = username;
    utilisateur.displayName = saisie.displayName.trim();
    utilisateur.email = email;
  });
}

export async function setManagedUserActive(saisie: {
  userId: string;
  isActive: boolean;
  actorUserId: string;
}) {
  if (!saisie.isActive && saisie.userId === saisie.actorUserId)
    throw new Error("CANNOT_DISABLE_SELF");
  await mutateAuthPayload(saisie.actorUserId, (contenu) => {
    const utilisateur = contenu.users.find((candidat) => candidat.id === saisie.userId);
    if (!utilisateur) throw new Error("USER_NOT_FOUND");
    utilisateur.isActive = saisie.isActive;
    if (!saisie.isActive) {
      contenu.sessions = contenu.sessions.filter((session) => session.userId !== saisie.userId);
    }
  });
}

export async function replaceManagedUserPermissions(saisie: {
  userId: string;
  modules: Array<{ moduleKey: string; accessLevel: AccessLevel }>;
  specialPermissions: string[];
}) {
  const auteur = await requirePermissionAdministrator();
  await mutateAuthPayload(auteur.id, (contenu) => {
    const utilisateur = contenu.users.find((candidat) => candidat.id === saisie.userId);
    if (!utilisateur) throw new Error("USER_NOT_FOUND");
    utilisateur.modulePermissions = Object.fromEntries(
      saisie.modules.map((permission) => [permission.moduleKey, permission.accessLevel]),
    );
    utilisateur.specialPermissions = [...new Set(saisie.specialPermissions)];
  });
}

export async function resetManagedUserPassword(saisie: { userId: string }) {
  const auteur = await requirePermissionAdministrator();
  const contenu = await readAuthPayload();
  const utilisateur = contenu.users.find(
    (candidat) => candidat.id === saisie.userId && candidat.isActive,
  );
  if (!utilisateur) throw new Error("USER_NOT_FOUND");

  const setup = newPasswordSetupToken(60);
  await createPasswordSetupToken({
    userId: utilisateur.id,
    tokenHash: setup.tokenHash,
    purpose: "admin_reset",
    createdByUserId: auteur.id,
    expiresAt: setup.expiresAt,
  });
  return {
    setupUrl: `/setup-password?token=${encodeURIComponent(setup.token)}`,
    expiresAt: setup.expiresAt.toISOString(),
  };
}

export async function revokeManagedUserSession(saisie: { userId: string; sessionId: string }) {
  const auteur = await requirePermissionAdministrator();
  await mutateAuthPayload(auteur.id, (contenu) => {
    if (!contenu.users.some((candidat) => candidat.id === saisie.userId)) {
      throw new Error("USER_NOT_FOUND");
    }
    contenu.sessions = contenu.sessions.filter(
      (session) => !(session.userId === saisie.userId && session.id === saisie.sessionId),
    );
  });
}
