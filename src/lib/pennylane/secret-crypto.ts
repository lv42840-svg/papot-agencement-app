import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_NAME = "PAPOT_PENNYLANE_ENCRYPTION_KEY";
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const input = env[KEY_NAME]?.trim();
  if (!input) throw new Error("PENNYLANE_ENCRYPTION_KEY_MISSING");
  if (!KEY_PATTERN.test(input)) throw new Error("PENNYLANE_ENCRYPTION_KEY_INVALID");
  const key = Buffer.from(input, "base64");
  if (key.length !== 32 || key.toString("base64") !== input) {
    throw new Error("PENNYLANE_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

export function pennylaneEncryptionReady(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    encryptionKey(env);
    return true;
  } catch {
    return false;
  }
}

/** AES-256-GCM with a fresh nonce for every saved/rotated token. */
export function sealPennylaneToken(
  token: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = encryptionKey(env);
  if (token.length < 20 || token.length > 2048 || /\s/.test(token)) {
    throw new Error("PENNYLANE_TOKEN_FORMAT_INVALID");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function unsealPennylaneToken(
  sealed: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = encryptionKey(env);
  try {
    const segments = sealed.split(":");
    if (segments.length !== 4 || segments[0] !== "v1") throw new Error("BAD_SEAL");
    const nonce = Buffer.from(segments[1], "base64");
    const tag = Buffer.from(segments[2], "base64");
    const encrypted = Buffer.from(segments[3], "base64");
    if (nonce.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error("BAD_SEAL");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    // Never emit token, ciphertext, key or crypto implementation errors to the caller.
    throw new Error("PENNYLANE_SECRET_UNREADABLE");
  }
}
