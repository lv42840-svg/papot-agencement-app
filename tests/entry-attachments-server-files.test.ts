import { File } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cleanupEntryAttachments,
  readEntryAttachment,
  uploadEntryAttachments,
} from "../src/lib/entries/attachment-storage";
import { ServerFileStore } from "../src/lib/server-files/storage";

const tempRoots: string[] = [];

async function createTransport() {
  const root = await mkdtemp(path.join(os.tmpdir(), "papot-entry-files-"));
  tempRoots.push(root);
  return {
    store: new ServerFileStore(root),
    displayName: "Test User",
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Entry attachment server files", () => {
  it("uploads, hashes and reads an attachment from the PAPOT server file store", async () => {
    const transport = await createTransport();
    const file = new File([Buffer.from("contenu test")], "plan:atelier?.pdf", {
      type: "application/pdf",
    });

    const uploaded = await uploadEntryAttachments(
      transport,
      "11111111-1111-4111-8111-111111111111",
      [file],
      new Date("2026-09-14T10:00:00.000Z"),
    );

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.fileName).toBe("plan:atelier?.pdf");
    expect(uploaded[0]?.storagePath).toMatch(
      /^documents\/entries\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\/plan-atelier-\.pdf$/,
    );
    expect(uploaded[0]?.sizeBytes).toBe(Buffer.byteLength("contenu test"));
    expect(uploaded[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);

    const bytes = await readEntryAttachment(transport, uploaded[0]!);
    expect(bytes.toString("utf8")).toBe("contenu test");
  });

  it("removes uploaded files during cleanup", async () => {
    const transport = await createTransport();
    const [attachment] = await uploadEntryAttachments(
      transport,
      "22222222-2222-4222-8222-222222222222",
      [new File(["photo"], "photo.jpg", { type: "image/jpeg" })],
    );

    await cleanupEntryAttachments(transport, [attachment!]);

    await expect(readEntryAttachment(transport, attachment!)).rejects.toThrow(
      "SERVER_FILE_NOT_FOUND",
    );
  });

  it("detects a corrupted server copy through SHA-256", async () => {
    const transport = await createTransport();
    const [attachment] = await uploadEntryAttachments(
      transport,
      "33333333-3333-4333-8333-333333333333",
      [new File(["original"], "piece.txt", { type: "text/plain" })],
    );

    const absolute = path.join(transport.store.rootPath, ...attachment!.storagePath.split("/"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(absolute, "corrompu");

    await expect(readEntryAttachment(transport, attachment!)).rejects.toThrow(
      "SERVER_FILE_INTEGRITY_MISMATCH",
    );
  });
});
