import { z } from "zod";

import { MODULE_PERMISSIONS } from "./permission-catalog";

export type AccessLevel = "READ" | "WRITE";

const accessLevelSchema = z.enum(["READ", "WRITE"]);
const storedUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._-]+$/).optional(),
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
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const cleaned = local.replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 70);
  return `user-${id.replace(/-/g, "").slice(0, 8)}`;
}

function ensureUsernames(users: Array<z.infer<typeof storedUserSchema>>): AuthUserRecord[] {
  const used = new Set<string>();
  return users.map((user) => {
    const requested = user.username?.toLowerCase();
    const base =
      requested && requested.length >= 3
        ? requested
        : normalizedUsernameBase(user.email, user.id);
    let username = base;
    let suffix = 2;
    while (used.has(username.toLowerCase())) {
      username = `${base.slice(0, Math.max(3, 78 - String(suffix).length))}-${suffix}`;
      suffix += 1;
    }
    used.add(username.toLowerCase());
    return { ...user, username };
  });
}

function preserveLegacyFullAccess(payload: AuthPayload): void {
  const legacyModuleKeys = MODULE_PERMISSIONS.map((module) => module.key).filter(
    (moduleKey) => moduleKey !== "clients",
  );

  for (const user of payload.users) {
    if (user.modulePermissions.clients) continue;
    const hadFullWriteAccess = legacyModuleKeys.every(
      (moduleKey) => user.modulePermissions[moduleKey] === "WRITE",
    );
    if (hadFullWriteAccess) user.modulePermissions.clients = "WRITE";
  }
}

export function parseAuthPayload(value: unknown): AuthPayload {
  if (value == null) return emptyAuthPayload();
  const parsed = storedAuthPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("AUTH_STORE_INVALID");
  const payload: AuthPayload = {
    schemaVersion: 1,
    users: ensureUsernames(parsed.data.users),
    sessions: parsed.data.sessions,
  };
  preserveLegacyFullAccess(payload);
  return payload;
}

export function pruneExpiredSessions(payload: AuthPayload, now = new Date()): void {
  const cutoff = now.getTime();
  payload.sessions = payload.sessions.filter((session) => Date.parse(session.expiresAt) > cutoff);
}
