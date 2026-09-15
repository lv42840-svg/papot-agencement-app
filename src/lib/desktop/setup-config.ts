import { randomUUID } from "node:crypto";
import { z } from "zod";

export const LOCAL_DESKTOP_SETUP_SCHEMA_VERSION = 3 as const;
export const DEFAULT_NEXTCLOUD_SYNC_ROOT = "PAPOT_SYNC";

const windowsSharedPathSchema = z
  .string()
  .trim()
  .min(3)
  .max(1024)
  .refine(
    (value) => /^[A-Za-z]:\\/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value),
    "SHARED_PATH_MUST_BE_WINDOWS_ABSOLUTE_OR_UNC",
  );

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .transform((value) => value.replace(/\/+$/, ""))
  .refine((value) => new URL(value).protocol === "https:", "NEXTCLOUD_HTTPS_REQUIRED");

const safeSyncRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/, "SYNC_ROOT_UNSAFE");

export const localDesktopSetupConfigSchema = z
  .object({
    schema_version: z.literal(LOCAL_DESKTOP_SETUP_SCHEMA_VERSION),
    shared_data_path: windowsSharedPathSchema,
    nextcloud_base_url: httpsUrlSchema,
    nextcloud_login: z.string().trim().min(1).max(200),
    nextcloud_user_id: z.string().trim().min(1).max(200),
    nextcloud_sync_root: safeSyncRootSchema,
    device_id: z.string().uuid(),
    device_label: z.string().trim().min(1).max(120),
    nextcloud_app_password_secret_key: z.string().trim().min(1).max(120),
  })
  .strict();

export type LocalDesktopSetupConfig = z.infer<typeof localDesktopSetupConfigSchema>;

export type CreateLocalDesktopSetupInput = {
  sharedDataPath: string;
  nextcloudBaseUrl: string;
  nextcloudLogin: string;
  nextcloudUserId: string;
  deviceLabel: string;
  deviceId?: string;
  nextcloudSyncRoot?: string;
  nextcloudAppPasswordSecretKey?: string;
};

export function createLocalDesktopSetupConfig(
  input: CreateLocalDesktopSetupInput,
): LocalDesktopSetupConfig {
  return localDesktopSetupConfigSchema.parse({
    schema_version: LOCAL_DESKTOP_SETUP_SCHEMA_VERSION,
    shared_data_path: input.sharedDataPath,
    nextcloud_base_url: input.nextcloudBaseUrl,
    nextcloud_login: input.nextcloudLogin,
    nextcloud_user_id: input.nextcloudUserId,
    nextcloud_sync_root: input.nextcloudSyncRoot ?? DEFAULT_NEXTCLOUD_SYNC_ROOT,
    device_id: input.deviceId ?? randomUUID(),
    device_label: input.deviceLabel,
    nextcloud_app_password_secret_key:
      input.nextcloudAppPasswordSecretKey ?? "nextcloud-app-password",
  });
}

export function localDesktopSetupContainsPlaintextSecret(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  const keys = Object.keys(value as Record<string, unknown>).map((key) => key.toLowerCase());
  return keys.some(
    (key) =>
      key === "nextcloud_app_password" ||
      key === "app_password" ||
      key === "database_url" ||
      key === "connection_string" ||
      key === "password" ||
      key === "secret",
  );
}
