import { createHash, createPublicKey, verify } from "node:crypto";
import {
  syncBusinessRequestText,
  syncPackageSchema,
  syncPackageSigningText,
  type SyncPackage,
} from "./protocol";

export function syncPackagePayloadHash(input: SyncPackage): string {
  const parsed = syncPackageSchema.parse(input);
  return createHash("sha256").update(syncPackageSigningText(parsed), "utf8").digest("hex");
}

export function syncBusinessRequestHash(input: SyncPackage): string {
  const parsed = syncPackageSchema.parse(input);
  return createHash("sha256").update(syncBusinessRequestText(parsed), "utf8").digest("hex");
}

export function verifySyncPackageSignature(input: SyncPackage, publicKeyPem: string): boolean {
  const parsed = syncPackageSchema.parse(input);
  const publicKey = createPublicKey(publicKeyPem);
  const signature = Buffer.from(parsed.proof.signature, "base64");

  return verify(
    null,
    Buffer.from(syncPackageSigningText(parsed), "utf8"),
    publicKey,
    signature,
  );
}
