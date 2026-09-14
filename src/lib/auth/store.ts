import "server-only";

import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import {
  parseAuthPayload,
  pruneExpiredSessions,
  type AuthPayload,
} from "./domain";

export type {
  AccessLevel,
  AuthPayload,
  AuthSessionRecord,
  AuthUserRecord,
} from "./domain";

export const AUTH_RESOURCE = { resource_type: "AUTH" as const, resource_id: "global" };

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
