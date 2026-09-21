import { z } from "zod";

import { MODULE_PERMISSIONS } from "./permission-catalog";

export type AccessLevel = "READ" | "WRITE";

const accessLevelSchema = z.enum(["READ", "WRITE"]);
const userSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  email: z.string().email(),
  passwordHash: z.string().min(1),
  isActive: z.boolean(),
  canManagePermissions: z.boolean(),
  mustChangePassword: z.boolean(),
  accentKey: z.string().min(1),
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
const authPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  users: z.array(userSchema),
  sessions: z.array(sessionSchema),
});

export type AuthUserRecord = z.infer<typeof userSchema>;
export type AuthSessionRecord = z.infer<typeof sessionSchema>;
export type AuthPayload = z.infer<typeof authPayloadSchema>;

export function emptyAuthPayload(): AuthPayload {
  return { schemaVersion: 1, users: [], sessions: [] };
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
  const parsed = authPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("AUTH_STORE_INVALID");
  preserveLegacyFullAccess(parsed.data);
  return parsed.data;
}

export function pruneExpiredSessions(payload: AuthPayload, now = new Date()): void {
  const cutoff = now.getTime();
  payload.sessions = payload.sessions.filter((session) => Date.parse(session.expiresAt) > cutoff);
}
