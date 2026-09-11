import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  syncPackageSchema,
  syncPackageSigningText,
  type SyncPackage,
} from "../src/lib/sync/protocol";
import { verifySyncPackageSignature } from "../src/lib/sync/signature";

const packageId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const responsibleId = "55555555-5555-4555-8555-555555555555";
const attachmentId = "66666666-6666-4666-8666-666666666666";

function unsignedPackage() {
  return {
    package_id: packageId,
    schema_version: 1 as const,
    app_version: "0.1.0",
    operation: "capture.create" as const,
    papot_user_id: userId,
    device_id: deviceId,
    created_at: "2026-09-11T20:00:00+02:00",
    client_request_id: requestId,
    payload: {
      title: "Client Dupont - entree magasin",
      responsibleUserId: responsibleId,
      priority: "NORMAL" as const,
      dueAt: null,
      tagIds: [],
    },
    attachments: [
      {
        attachment_id: attachmentId,
        file_name: "photo.jpg",
        content_type: "image/jpeg",
        size_bytes: 1234,
        sha256: "a".repeat(64),
        object_name: `${attachmentId}.jpg`,
      },
    ],
    proof: {
      algorithm: "Ed25519" as const,
      key_id: "iphone-lucien-1",
      signature: "A".repeat(86) + "==",
    },
  };
}

function signedPackage(): { packet: SyncPackage; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const draft = syncPackageSchema.parse(unsignedPackage());
  const signature = sign(null, Buffer.from(syncPackageSigningText(draft), "utf8"), privateKey).toString(
    "base64",
  );
  const packet = syncPackageSchema.parse({
    ...draft,
    proof: { ...draft.proof, signature },
  });

  return {
    packet,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("sync package protocol", () => {
  it("accepts the versioned capture package and attachment hash metadata", () => {
    expect(syncPackageSchema.safeParse(unsignedPackage()).success).toBe(true);
  });

  it("refuses Nextcloud-reserved .part staging names", () => {
    const input = unsignedPackage();
    input.attachments[0].object_name = "upload.part";
    expect(syncPackageSchema.safeParse(input).success).toBe(false);
  });

  it("canonicalizes object keys deterministically", () => {
    expect(canonicalizeJson({ z: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"z":1}',
    );
  });

  it("verifies an Ed25519 device proof and rejects a tampered payload", () => {
    const { packet, publicKeyPem } = signedPackage();
    expect(verifySyncPackageSignature(packet, publicKeyPem)).toBe(true);

    const tampered = syncPackageSchema.parse({
      ...packet,
      payload: { ...packet.payload, title: "Titre modifie" },
    });
    expect(verifySyncPackageSignature(tampered, publicKeyPem)).toBe(false);
  });
});
