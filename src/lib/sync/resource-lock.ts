import { z } from "zod";

export const SHARED_RESOURCE_LOCK_SCHEMA_VERSION = 1 as const;
export const DEFAULT_RESOURCE_LOCK_TTL_MS = 5 * 60 * 1000;

export const sharedResourceTypeSchema = z.enum([
  "CHANTIER",
  "PLANNING_WEEK",
  "TREASURY_MONTH",
  "ENTRIES",
  "CLIENTS",
  "COMMERCIAL",
  "AUTH",
]);

export const sharedResourceRefSchema = z.object({
  resource_type: sharedResourceTypeSchema,
  resource_id: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/, "RESOURCE_ID_UNSAFE"),
});

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const sharedResourceLockSchema = z
  .object({
    schema_version: z.literal(SHARED_RESOURCE_LOCK_SCHEMA_VERSION),
    resource: sharedResourceRefSchema,
    lease_id: z.string().uuid(),
    owner_user_id: z.string().uuid(),
    owner_device_id: z.string().uuid(),
    owner_display_name: z.string().trim().min(1).max(120),
    base_version: z.number().int().nonnegative(),
    acquired_at: isoDateTimeSchema,
    renewed_at: isoDateTimeSchema,
    expires_at: isoDateTimeSchema,
  })
  .superRefine((value, context) => {
    const acquiredAt = Date.parse(value.acquired_at);
    const renewedAt = Date.parse(value.renewed_at);
    const expiresAt = Date.parse(value.expires_at);

    if (renewedAt < acquiredAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renewed_at"],
        message: "LOCK_RENEWED_BEFORE_ACQUIRED",
      });
    }

    if (expiresAt <= renewedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expires_at"],
        message: "LOCK_EXPIRES_TOO_EARLY",
      });
    }
  });

export const sharedResourceEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  resource: sharedResourceRefSchema,
  version: z.number().int().nonnegative(),
  updated_at: isoDateTimeSchema,
  updated_by_user_id: z.string().uuid(),
  updated_by_device_id: z.string().uuid(),
  payload: z.unknown(),
});

export type SharedResourceType = z.infer<typeof sharedResourceTypeSchema>;
export type SharedResourceRef = z.infer<typeof sharedResourceRefSchema>;
export type SharedResourceLock = z.infer<typeof sharedResourceLockSchema>;
export type SharedResourceEnvelope = z.infer<typeof sharedResourceEnvelopeSchema>;

export type ResourceLockOwner = {
  userId: string;
  deviceId: string;
  displayName: string;
};

export function resourceLockPathSegments(resource: SharedResourceRef): string[] {
  const parsed = sharedResourceRefSchema.parse(resource);
  return ["locks", parsed.resource_type.toLowerCase(), `${parsed.resource_id}.json`];
}

export function isResourceLockExpired(lock: SharedResourceLock, now: Date = new Date()): boolean {
  const parsed = sharedResourceLockSchema.parse(lock);
  return Date.parse(parsed.expires_at) <= now.getTime();
}

export function isResourceLockOwnedBy(
  lock: SharedResourceLock,
  leaseId: string,
  owner: Pick<ResourceLockOwner, "userId" | "deviceId">,
): boolean {
  const parsed = sharedResourceLockSchema.parse(lock);
  return (
    parsed.lease_id === leaseId &&
    parsed.owner_user_id === owner.userId &&
    parsed.owner_device_id === owner.deviceId
  );
}

export function resourceLockBlocksWrite(
  lock: SharedResourceLock | null,
  now: Date = new Date(),
): boolean {
  if (!lock) return false;
  return !isResourceLockExpired(lock, now);
}

export function createResourceLock(params: {
  resource: SharedResourceRef;
  leaseId: string;
  owner: ResourceLockOwner;
  baseVersion: number;
  now?: Date;
  ttlMs?: number;
}): SharedResourceLock {
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_RESOURCE_LOCK_TTL_MS;

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("LOCK_TTL_INVALID");
  }

  const timestamp = now.toISOString();

  return sharedResourceLockSchema.parse({
    schema_version: SHARED_RESOURCE_LOCK_SCHEMA_VERSION,
    resource: params.resource,
    lease_id: params.leaseId,
    owner_user_id: params.owner.userId,
    owner_device_id: params.owner.deviceId,
    owner_display_name: params.owner.displayName,
    base_version: params.baseVersion,
    acquired_at: timestamp,
    renewed_at: timestamp,
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  });
}

export function renewResourceLock(params: {
  current: SharedResourceLock;
  leaseId: string;
  owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
  now?: Date;
  ttlMs?: number;
}): SharedResourceLock {
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_RESOURCE_LOCK_TTL_MS;
  const current = sharedResourceLockSchema.parse(params.current);

  if (isResourceLockExpired(current, now)) {
    throw new Error("LOCK_EXPIRED");
  }

  if (!isResourceLockOwnedBy(current, params.leaseId, params.owner)) {
    throw new Error("LOCK_NOT_OWNED");
  }

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("LOCK_TTL_INVALID");
  }

  return sharedResourceLockSchema.parse({
    ...current,
    renewed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  });
}

export function hasSharedResourceVersionConflict(
  openedVersion: number,
  currentVersion: number,
): boolean {
  if (!Number.isInteger(openedVersion) || openedVersion < 0) {
    throw new Error("OPENED_VERSION_INVALID");
  }
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error("CURRENT_VERSION_INVALID");
  }
  return openedVersion !== currentVersion;
}

export function nextSharedResourceVersion(currentVersion: number): number {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error("CURRENT_VERSION_INVALID");
  }
  return currentVersion + 1;
}
