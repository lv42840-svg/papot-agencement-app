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
  .superRefine((valeur, contexte) => {
    const acquisition = Date.parse(valeur.acquired_at);
    const renouvellement = Date.parse(valeur.renewed_at);
    const expiration = Date.parse(valeur.expires_at);

    if (renouvellement < acquisition) {
      contexte.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renewed_at"],
        message: "LOCK_RENEWED_BEFORE_ACQUIRED",
      });
    }
    if (expiration <= renouvellement) {
      contexte.addIssue({
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

export function isLibraryLockExpired(verrou: LibraryEditLock, maintenant = new Date()): boolean {
  const verrouValide = libraryEditLockSchema.parse(verrou);
  return Date.parse(verrouValide.expires_at) <= maintenant.getTime();
}

export function isLibraryLockOwnedBy(
  verrou: LibraryEditLock,
  idBail: string,
  proprietaire: Pick<LibraryLockOwner, "userId" | "deviceId">,
): boolean {
  const verrouValide = libraryEditLockSchema.parse(verrou);
  return (
    verrouValide.lease_id === idBail &&
    verrouValide.owner_user_id === proprietaire.userId &&
    verrouValide.owner_device_id === proprietaire.deviceId
  );
}

export function createLibraryLock(parametres: {
  leaseId: string;
  owner: LibraryLockOwner;
  baseVersion: number;
  now?: Date;
  ttlMs?: number;
}): LibraryEditLock {
  const maintenant = parametres.now ?? new Date();
  const dureeMs = parametres.ttlMs ?? DEFAULT_LIBRARY_LOCK_TTL_MS;
  if (!Number.isFinite(dureeMs) || dureeMs <= 0) {
    throw new Error("LOCK_TTL_INVALID");
  }
  const horodatage = maintenant.toISOString();

  return libraryEditLockSchema.parse({
    lease_id: parametres.leaseId,
    owner_user_id: parametres.owner.userId,
    owner_device_id: parametres.owner.deviceId,
    owner_display_name: parametres.owner.displayName,
    base_version: parametres.baseVersion,
    acquired_at: horodatage,
    renewed_at: horodatage,
    expires_at: new Date(maintenant.getTime() + dureeMs).toISOString(),
  });
}

export function renewLibraryLock(parametres: {
  current: LibraryEditLock;
  leaseId: string;
  owner: Pick<LibraryLockOwner, "userId" | "deviceId">;
  now?: Date;
  ttlMs?: number;
}): LibraryEditLock {
  const maintenant = parametres.now ?? new Date();
  const dureeMs = parametres.ttlMs ?? DEFAULT_LIBRARY_LOCK_TTL_MS;
  const verrouCourant = libraryEditLockSchema.parse(parametres.current);

  if (isLibraryLockExpired(verrouCourant, maintenant)) {
    throw new Error("LOCK_EXPIRED");
  }
  if (!isLibraryLockOwnedBy(verrouCourant, parametres.leaseId, parametres.owner)) {
    throw new Error("LOCK_NOT_OWNED");
  }
  if (!Number.isFinite(dureeMs) || dureeMs <= 0) {
    throw new Error("LOCK_TTL_INVALID");
  }

  return libraryEditLockSchema.parse({
    ...verrouCourant,
    renewed_at: maintenant.toISOString(),
    expires_at: new Date(maintenant.getTime() + dureeMs).toISOString(),
  });
}
