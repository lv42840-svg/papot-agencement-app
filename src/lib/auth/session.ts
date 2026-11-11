import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { mutateAuthPayload, readAuthPayload, readSessionIdentity } from "@/lib/auth/store";
import { newSessionToken } from "@/lib/auth/session-token";

const cookieName = process.env.SESSION_COOKIE_NAME ?? "papot_session";

function tokenHash(jeton: string) {
  return createHash("sha256").update(jeton).digest("hex");
}

function desktopDeviceIdentity(): {
  deviceId: string | null;
  deviceLabel: string | null;
} {
  const brut = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!brut) return { deviceId: null, deviceLabel: null };
  try {
    const donnees = JSON.parse(brut) as {
      device_id?: unknown;
      device_label?: unknown;
    };
    return {
      deviceId:
        typeof donnees.device_id === "string" && donnees.device_id ? donnees.device_id : null,
      deviceLabel:
        typeof donnees.device_label === "string" && donnees.device_label
          ? donnees.device_label
          : null,
    };
  } catch {
    return { deviceId: null, deviceLabel: null };
  }
}

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  accentKey: string;
  planningPotentialCollapsed: boolean;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
};

export async function setSessionCookie(jeton: string, expiration: Date) {
  const cookiesServeur = await cookies();
  cookiesServeur.set(cookieName, jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiration,
  });
}

export async function createSession(idUtilisateur: string) {
  const session = newSessionToken();
  const appareil = desktopDeviceIdentity();

  await mutateAuthPayload(idUtilisateur, (donnees) => {
    const utilisateur = donnees.users.find(
      (candidat) => candidat.id === idUtilisateur && candidat.isActive,
    );
    if (!utilisateur) throw new Error("AUTH_USER_NOT_FOUND");
    donnees.sessions.push({
      id: randomUUID(),
      tokenHash: session.tokenHash,
      userId: idUtilisateur,
      deviceId: appareil.deviceId,
      deviceLabel: appareil.deviceLabel,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  await setSessionCookie(session.token, session.expiresAt);
}

export async function destroySession() {
  const cookiesServeur = await cookies();
  const jeton = cookiesServeur.get(cookieName)?.value;
  if (jeton) {
    const empreinte = tokenHash(jeton);
    const donnees = await readAuthPayload();
    const session = donnees.sessions.find((candidat) => candidat.tokenHash === empreinte);
    if (session) {
      await mutateAuthPayload(session.userId, (brouillon) => {
        brouillon.sessions = brouillon.sessions.filter(
          (candidat) => candidat.tokenHash !== empreinte,
        );
      });
    }
  }
  cookiesServeur.delete(cookieName);
}

export async function destroyAllSessionsForUser(idUtilisateur: string) {
  await mutateAuthPayload(idUtilisateur, (donnees) => {
    donnees.sessions = donnees.sessions.filter((session) => session.userId !== idUtilisateur);
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jeton = (await cookies()).get(cookieName)?.value;
  if (!jeton) return null;

  return readSessionIdentity(tokenHash(jeton));
}

export async function requireUser(): Promise<CurrentUser> {
  const utilisateur = await getCurrentUser();
  if (!utilisateur) redirect("/login");
  if (utilisateur.mustChangePassword) redirect("/change-password");
  return utilisateur;
}
