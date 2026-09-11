import { z } from "zod";
import { captureCreateSchema } from "../capture/schema";

export const SYNC_SCHEMA_VERSION = 1 as const;

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const safeObjectNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine((value) => !value.toLowerCase().endsWith(".part"), {
    message: "The .part suffix is reserved by Nextcloud and cannot be used for PAPOT staging",
  });

export const syncAttachmentSchema = z
  .object({
    attachment_id: uuidSchema,
    file_name: z.string().trim().min(1).max(240),
    content_type: z.string().trim().min(1).max(120),
    size_bytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
    sha256: sha256Schema,
    object_name: safeObjectNameSchema,
  })
  .strict();

const captureTransportPayloadSchema = captureCreateSchema
  .omit({ clientRequestId: true })
  .strict();

const deviceProofSchema = z
  .object({
    algorithm: z.literal("Ed25519"),
    key_id: z.string().trim().min(1).max(80),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();

export const captureCreateSyncPackageSchema = z
  .object({
    package_id: uuidSchema,
    schema_version: z.literal(SYNC_SCHEMA_VERSION),
    app_version: z.string().trim().min(1).max(40),
    operation: z.literal("capture.create"),
    papot_user_id: uuidSchema,
    device_id: uuidSchema,
    created_at: z.string().datetime({ offset: true }),
    client_request_id: uuidSchema,
    payload: captureTransportPayloadSchema,
    attachments: z.array(syncAttachmentSchema).max(10).default([]),
    proof: deviceProofSchema,
  })
  .strict();

export const syncPackageSchema = captureCreateSyncPackageSchema;

export type SyncPackage = z.infer<typeof syncPackageSchema>;
export type SyncAttachment = z.infer<typeof syncAttachmentSchema>;

function canonicalizeObject(value: Record<string, unknown>): string {
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
    .join(",")}}`;
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_CANONICAL_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  if (typeof value === "object") return canonicalizeObject(value as Record<string, unknown>);
  throw new Error("NON_CANONICAL_JSON_VALUE");
}

export function syncPackageSigningText(input: SyncPackage): string {
  const parsed = syncPackageSchema.parse(input);
  const { signature: _signature, ...proofWithoutSignature } = parsed.proof;
  return canonicalizeJson({
    ...parsed,
    proof: proofWithoutSignature,
  });
}

export function syncBusinessRequestText(input: SyncPackage): string {
  const parsed = syncPackageSchema.parse(input);
  return canonicalizeJson({
    operation: parsed.operation,
    papot_user_id: parsed.papot_user_id,
    client_request_id: parsed.client_request_id,
    payload: parsed.payload,
    attachments: parsed.attachments,
  });
}
