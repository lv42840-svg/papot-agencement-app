import { describe, expect, it } from "vitest";
import {
  pennylaneEncryptionReady,
  sealPennylaneToken,
  unsealPennylaneToken,
} from "../src/lib/pennylane/secret-crypto";

const env = { PAPOT_PENNYLANE_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString("base64") };
const other = { PAPOT_PENNYLANE_ENCRYPTION_KEY: Buffer.alloc(32, 43).toString("base64") };
const testToken = "fake-pennylane-token-for-unit-tests-only";

describe("Pennylane admin credential encryption", () => {
  it("requires a valid 256-bit key stored outside the database", () => {
    expect(pennylaneEncryptionReady({})).toBe(false);
    expect(pennylaneEncryptionReady({ PAPOT_PENNYLANE_ENCRYPTION_KEY: "not-a-key" })).toBe(false);
    expect(pennylaneEncryptionReady(env)).toBe(true);
    expect(() => sealPennylaneToken(testToken, {})).toThrow("PENNYLANE_ENCRYPTION_KEY_MISSING");
  });

  it("encrypts with a new nonce on every save and can decrypt without revealing plaintext", () => {
    const first = sealPennylaneToken(testToken, env);
    const second = sealPennylaneToken(testToken, env);
    expect(first).toMatch(/^v1:/);
    expect(second).not.toEqual(first);
    expect(first).not.toContain(testToken);
    expect(unsealPennylaneToken(first, env)).toBe(testToken);
    expect(unsealPennylaneToken(second, env)).toBe(testToken);
  });

  it("fails closed when ciphertext is tampered with or the key changes", () => {
    const first = sealPennylaneToken(testToken, env);
    await expect(async () => unsealPennylaneToken(first, other)).rejects.toThrow(
      "PENNYLANE_SECRET_UNREADABLE",
    );
    const corrupted = first.slice(0, -3) + "AAA";
    expect(() => unsealPennylaneToken(corrupted, env)).toThrow("PENNYLANE_SECRET_UNREADABLE");
    expect(() => sealPennylaneToken("space in token", env)).toThrow(
      "PENNYLANE_TOKEN_FORMAT_INVALID",
    );
  });
});
