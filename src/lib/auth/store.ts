import "server-only";

import { z } from "zod";
import { MODULE_PERMISSIONS } from "@/lib/auth/permission-catalog";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";

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

export const AUTH_RESOURCE = { resource_type: "AUTH" as const, resource_id: "global" };

function emptyAuthPayload(): AuthPayload {
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

function pruneExpiredSessions(payload: AuthPayload, now = new Date()): void {
  const cutoff = now.getTime();
  payload.sessions = payload.sessions.filter((session) => Date.parse(session.expiresAt) > cutoff);
}

export async function readAuthPayload(): Promise<AuthPayload> {
  const desktop = createDesktopSharedResourceRuntime();
  const resource = await desktop.states.get(AUTH_RESOURCE);
  const payload = parseAuthPayload(resource?.payload);
  pruneExpiredSessions(payload);
  return payload;
}

export async function mutateAuthPayload<T>(
  actorUserId: string,
  mutate: (payload: AuthPayload) => T | Promise<T>,
): Promise<{ payload: AuthPayload; result: T }> {
  const desktop = createDesktopSharedResourceRuntime();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const opened = await desktop.states.openForUpdate(AUTH_RESOURCE);
    const payload = parseAuthPayload(opened.resource?.payload);
    pruneExpiredSessions(payload);
    const result = await mutate(payload);
    const saved = await desktop.states.saveOpened({
      resource: AUTH_RESOURCE,
      opened,
      payload,
      actor: { userId: actorUserId, deviceId: desktop.deviceId },
    });
    if (saved.status === "saved") {
      return { payload: parseAuthPayload(saved.resource.payload), result };
    }
  }

  throw new Error("AUTH_STORE_CONFLICT");
}

export async function authHasUsers(): Promise<boolean> {
  return (await readAuthPayload()).users.length > 0;
}
