import { z } from "zod";

import { MODULE_PERMISSIONS } from "./permission-catalog";

export type AccessLevel = "READ" | "WRITE";

const accessLevelSchema = z.enum(["READ", "WRITE"]);
const storedUserSchema = z.object({
  id: z.string().uuid(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/)
    .optional(),
  displayName: z.string().min(1),
  email: z.string().email(),
  passwordHash: z.string().min(1),
  isActive: z.boolean(),
  canManagePermissions: z.boolean(),
  mustChangePassword: z.boolean(),
  accentKey: z.string().min(1),
  planningPotentialCollapsed: z.boolean().optional(),
  modulePermissions: z.record(accessLevelSchema),
  specialPermissions: z.array(z.string()),
});
const sessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  tokenHash: z.string().min(1),
  deviceId: z.string().uuid().nullable(),
  deviceLabel: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});
const storedAuthPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  users: z.array(storedUserSchema),
  sessions: z.array(sessionSchema),
});

export type AuthUserRecord = Omit<z.infer<typeof storedUserSchema>, "username"> & {
  username: string;
};
export type AuthSessionRecord = z.infer<typeof sessionSchema>;
export type AuthPayload = {
  schemaVersion: 1;
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
};

export function emptyAuthPayload(): AuthPayload {
  return { schemaVersion: 1, users: [], sessions: [] };
}

function normalizedUsernameBase(email: string, id: string): string {
  const partieLocale = email.split("@")[0]?.toLowerCase() ?? "";
  const nettoye = partieLocale.replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
  if (nettoye.length >= 3) return nettoye.slice(0, 70);
  return `user-${id.replace(/-/g, "").slice(0, 8)}`;
}

function ensureUsernames(utilisateurs: Array<z.infer<typeof storedUserSchema>>): AuthUserRecord[] {
  const nomsUtilises = new Set<string>();
  return utilisateurs.map((utilisateur) => {
    const nomDemande = utilisateur.username?.toLowerCase();
    const base =
      nomDemande && nomDemande.length >= 3
        ? nomDemande
        : normalizedUsernameBase(utilisateur.email, utilisateur.id);
    let nomUtilisateur = base;
    let suffixe = 2;
    while (nomsUtilises.has(nomUtilisateur.toLowerCase())) {
      nomUtilisateur = `${base.slice(0, Math.max(3, 78 - String(suffixe).length))}-${suffixe}`;
      suffixe += 1;
    }
    nomsUtilises.add(nomUtilisateur.toLowerCase());
    return { ...utilisateur, username: nomUtilisateur };
  });
}

function preserveLegacyFullAccess(donnees: AuthPayload): void {
  const clesModulesHistoriques = MODULE_PERMISSIONS.map((module) => module.key).filter(
    (cleModule) => cleModule !== "clients",
  );

  for (const utilisateur of donnees.users) {
    if (utilisateur.modulePermissions.clients) continue;
    const avaitAccesComplet = clesModulesHistoriques.every(
      (cleModule) => utilisateur.modulePermissions[cleModule] === "WRITE",
    );
    if (avaitAccesComplet) utilisateur.modulePermissions.clients = "WRITE";
  }
}

export function parseAuthPayload(valeur: unknown): AuthPayload {
  if (valeur == null) return emptyAuthPayload();
  const analyse = storedAuthPayloadSchema.safeParse(valeur);
  if (!analyse.success) throw new Error("AUTH_STORE_INVALID");
  const donnees: AuthPayload = {
    schemaVersion: 1,
    users: ensureUsernames(analyse.data.users),
    sessions: analyse.data.sessions,
  };
  preserveLegacyFullAccess(donnees);
  return donnees;
}

export function pruneExpiredSessions(donnees: AuthPayload, maintenant = new Date()): void {
  const limite = maintenant.getTime();
  donnees.sessions = donnees.sessions.filter((session) => Date.parse(session.expiresAt) > limite);
}
