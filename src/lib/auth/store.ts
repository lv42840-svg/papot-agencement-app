import "server-only";

export { authHasUsers, mutateAuthPayload, readAuthPayload } from "./runtime-store";
export type { AccessLevel, AuthPayload, AuthSessionRecord, AuthUserRecord } from "./domain";

export const AUTH_RESOURCE = { resource_type: "AUTH" as const, resource_id: "global" };
