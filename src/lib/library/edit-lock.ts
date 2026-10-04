import { z } from "zod";
import type { LibraryPayload } from "./storage";

export const DEFAULT_LIBRARY_LOCK_TTL_MS = 5 * 60 * 1000;

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const libraryEditLockSchema = z
  .object({
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

export type LibraryEditLock = z.infer<typeof libraryEditLockSchema>;

export type LibraryLockOwner = {
  userId: string;
  deviceId: string;
  displayName: string;
};

export type LibraryEnvelope = {
  version: number;
  payload: LibraryPayload;
};

export type OpenLibraryResult =
  | {
      status: "editable";
      resource: LibraryEnvelope;
      lock: LibraryEditLock;
      baseVersion: number;
    }
  | {
      status: "read-only";
      resource: LibraryEnvelope;
      lock: LibraryEditLock;
      baseVersion: number;
    };

export type SaveLibraryEditResult =
  | { status: "saved"; resource: LibraryEnvelope }
  | { status: "conflict"; current: LibraryEnvelope };

export function isLibraryLockExpired(lock: LibraryEditLock, now = new Date()): boolean {
  const parsed = libraryEditLockSchema.parse(lock);
  return Date.parse(parsed.expires_at) <= now.getTime();
}

export function isLibraryLockOwnedBy(
  lock: LibraryEditLock,
  leaseId: string,
  owner: Pick<LibraryLockOwner, "userId" | "deviceId">,
): boolean {
  const parsed = libraryEditLockSchema.parse(lock);
  return (
    parsed.lease_id === leaseId &&
    parsed.owner_user_id === owner.userId &&
    parsed.owner_device_id === owner.deviceId
  );
}

export function createLibraryLock(params: {
  leaseId: string;
  owner: LibraryLockOwner;
  baseVersion: number;
  now?: Date;
  ttlMs?: number;
}): LibraryEditLock {
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_LIBRARY_LOCK_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("LOCK_TTL_INVALID");
  const timestamp = now.toISOString();

  return libraryEditLockSchema.parse({
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

export function renewLibraryLock(params: {
  current: LibraryEditLock;
  leaseId: string;
  owner: Pick<LibraryLockOwner, "userId" | "deviceId">;
  now?: Date;
  ttlMs?: number;
}): LibraryEditLock {
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_LIBRARY_LOCK_TTL_MS;
  const current = libraryEditLockSchema.parse(params.current);

  if (isLibraryLockExpired(current, now)) throw new Error("LOCK_EXPIRED");
  if (!isLibraryLockOwnedBy(current, params.leaseId, params.owner)) {
    throw new Error("LOCK_NOT_OWNED");
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("LOCK_TTL_INVALID");

  return libraryEditLockSchema.parse({
    ...current,
    renewed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  });
}
