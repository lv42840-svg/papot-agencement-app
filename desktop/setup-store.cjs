"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE_NAME = "papot-desktop-config.json";
const SECRET_FILE_NAME = "papot-nextcloud-secret.bin";
const SECRET_KEY_NAME = "nextcloud-app-password";
const DEFAULT_SYNC_ROOT = "PAPOT_SYNC";

function requiredTrimmed(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function normalizeSharedPath(value) {
  const normalized = requiredTrimmed(value, "DESKTOP_SHARED_PATH_REQUIRED");
  if (!/^[A-Za-z]:\\/.test(normalized) && !/^\\\\[^\\]+\\[^\\]+/.test(normalized)) {
    throw new Error("DESKTOP_SHARED_PATH_INVALID");
  }
  return normalized;
}

function normalizeNextcloudUrl(value) {
  const raw = requiredTrimmed(value, "DESKTOP_NEXTCLOUD_URL_REQUIRED");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DESKTOP_NEXTCLOUD_URL_INVALID");
  }
  if (parsed.protocol !== "https:") throw new Error("DESKTOP_NEXTCLOUD_HTTPS_REQUIRED");
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeSetupInput(input) {
  if (!input || typeof input !== "object") throw new Error("DESKTOP_SETUP_INVALID");

  return {
    sharedDataPath: normalizeSharedPath(input.sharedDataPath),
    nextcloudBaseUrl: normalizeNextcloudUrl(input.nextcloudBaseUrl),
    nextcloudLogin: requiredTrimmed(input.nextcloudLogin, "DESKTOP_NEXTCLOUD_LOGIN_REQUIRED"),
    nextcloudAppPassword: requiredTrimmed(
      input.nextcloudAppPassword,
      "DESKTOP_NEXTCLOUD_PASSWORD_REQUIRED",
    ),
    deviceLabel: requiredTrimmed(input.deviceLabel, "DESKTOP_DEVICE_LABEL_REQUIRED"),
    papotUserDisplayName: requiredTrimmed(
      input.papotUserDisplayName,
      "DESKTOP_PAPOT_USER_REQUIRED",
    ),
  };
}

function configPath(userDataPath) {
  return path.join(userDataPath, CONFIG_FILE_NAME);
}

function secretPath(userDataPath) {
  return path.join(userDataPath, SECRET_FILE_NAME);
}

function readDesktopSetupConfig(userDataPath) {
  try {
    const raw = fs.readFileSync(configPath(userDataPath), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.name === "SyntaxError")) return null;
    throw error;
  }
}

function hasDesktopSetup(userDataPath) {
  return Boolean(readDesktopSetupConfig(userDataPath)) && fs.existsSync(secretPath(userDataPath));
}

function saveDesktopSetup({ userDataPath, input, nextcloudUserId, safeStorage }) {
  const normalized = normalizeSetupInput(input);
  const canonicalUserId = requiredTrimmed(nextcloudUserId, "DESKTOP_NEXTCLOUD_USER_ID_REQUIRED");

  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== "function") {
    throw new Error("DESKTOP_SECRET_STORE_UNAVAILABLE");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("DESKTOP_SECRET_STORE_UNAVAILABLE");
  }
  if (typeof safeStorage.encryptString !== "function") {
    throw new Error("DESKTOP_SECRET_STORE_UNAVAILABLE");
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const previous = readDesktopSetupConfig(userDataPath);
  const config = {
    schema_version: 1,
    shared_data_path: normalized.sharedDataPath,
    nextcloud_base_url: normalized.nextcloudBaseUrl,
    nextcloud_login: normalized.nextcloudLogin,
    nextcloud_user_id: canonicalUserId,
    nextcloud_sync_root: DEFAULT_SYNC_ROOT,
    device_id:
      typeof previous?.device_id === "string" && previous.device_id
        ? previous.device_id
        : randomUUID(),
    device_label: normalized.deviceLabel,
    papot_user_id:
      typeof previous?.papot_user_id === "string" && previous.papot_user_id
        ? previous.papot_user_id
        : randomUUID(),
    papot_user_display_name: normalized.papotUserDisplayName,
    nextcloud_app_password_secret_key: SECRET_KEY_NAME,
  };

  const encrypted = safeStorage.encryptString(normalized.nextcloudAppPassword);
  if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
    throw new Error("DESKTOP_SECRET_ENCRYPTION_FAILED");
  }

  fs.writeFileSync(secretPath(userDataPath), encrypted, { mode: 0o600 });
  fs.writeFileSync(configPath(userDataPath), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return config;
}

module.exports = {
  CONFIG_FILE_NAME,
  DEFAULT_SYNC_ROOT,
  SECRET_FILE_NAME,
  hasDesktopSetup,
  normalizeSetupInput,
  readDesktopSetupConfig,
  saveDesktopSetup,
};
