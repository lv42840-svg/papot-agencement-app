import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getServerFileStore } from "../src/lib/server-files/runtime";
import {
  normalizeServerStoragePath,
  ServerFileStore,
  sha256Bytes,
} from "../src/lib/server-files/storage";

const roots: string[] = [];
const previousDesktopConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
const previousStorageMode = process.env.PAPOT_STORAGE_MODE;
const previousLocalFilesPath = process.env.PAPOT_LOCAL_FILES_PATH;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "papot-server-files-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  if (previousDesktopConfig === undefined) delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
  else process.env.PAPOT_DESKTOP_CONFIG_JSON = previousDesktopConfig;

  if (previousStorageMode === undefined) delete process.env.PAPOT_STORAGE_MODE;
  else process.env.PAPOT_STORAGE_MODE = previousStorageMode;

  if (previousLocalFilesPath === undefined) delete process.env.PAPOT_LOCAL_FILES_PATH;
  else process.env.PAPOT_LOCAL_FILES_PATH = previousLocalFilesPath;

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("server file storage", () => {
  it("writes nested bytes once and reads them back with integrity verification", async () => {
    const root = await temporaryRoot();
    const store = new ServerFileStore(root);
    const bytes = Buffer.from("PAPOT fichier serveur", "utf8");
    const storagePath = "documents/entries/entry-1/file-1/photo.jpg";

    const written = await store.writeBytes(storagePath, bytes);

    expect(written).toEqual({
      storagePath,
      sizeBytes: bytes.length,
      sha256: sha256Bytes(bytes),
    });
    await expect(store.readBytes(storagePath, written.sha256)).resolves.toEqual(bytes);
    await expect(readFile(path.join(root, ...storagePath.split("/")))).resolves.toEqual(bytes);
  });

  it("refuses to overwrite an existing file", async () => {
    const root = await temporaryRoot();
    const store = new ServerFileStore(root);
    const storagePath = "documents/test/file.txt";

    await store.writeBytes(storagePath, Buffer.from("premier"));
    await expect(store.writeBytes(storagePath, Buffer.from("second"))).rejects.toThrow(
      "SERVER_FILE_EXISTS",
    );
    await expect(store.readBytes(storagePath)).resolves.toEqual(Buffer.from("premier"));
  });

  it("rejects traversal, absolute paths and unsafe Windows file names", () => {
    expect(() => normalizeServerStoragePath("../secret.txt")).toThrow("SERVER_FILE_PATH_INVALID");
    expect(() => normalizeServerStoragePath("/etc/passwd")).toThrow("SERVER_FILE_PATH_INVALID");
    expect(() => normalizeServerStoragePath("C:\\temp\\secret.txt")).toThrow(
      "SERVER_FILE_PATH_INVALID",
    );
    expect(() => normalizeServerStoragePath("documents/a:b.txt")).toThrow(
      "SERVER_FILE_PATH_INVALID",
    );
  });

  it("detects a SHA-256 mismatch", async () => {
    const root = await temporaryRoot();
    const store = new ServerFileStore(root);
    await store.writeBytes("documents/test/hash.txt", Buffer.from("contenu"));

    await expect(store.readBytes("documents/test/hash.txt", "0".repeat(64))).rejects.toThrow(
      "SERVER_FILE_INTEGRITY_MISMATCH",
    );
  });

  it("deletes an existing file and reports a missing file without failing", async () => {
    const root = await temporaryRoot();
    const store = new ServerFileStore(root);
    const storagePath = "documents/test/delete.txt";
    await store.writeBytes(storagePath, Buffer.from("a supprimer"));

    await expect(store.deleteFile(storagePath)).resolves.toBe(true);
    await expect(store.deleteFile(storagePath)).resolves.toBe(false);
    await expect(store.readBytes(storagePath)).rejects.toThrow("SERVER_FILE_NOT_FOUND");
  });

  it("builds the runtime store from the configured shared_data_path in server mode", async () => {
    const root = await temporaryRoot();
    process.env.PAPOT_STORAGE_MODE = "server";
    process.env.PAPOT_DESKTOP_CONFIG_JSON = JSON.stringify({
      shared_data_path: root,
      nextcloud_base_url: "https://unused.example.test",
    });

    const store = getServerFileStore();
    expect(store.rootPath).toBe(path.resolve(root));
    await expect(store.assertReady()).resolves.toBeUndefined();
  });

  it("builds the runtime store from the local files path in local mode", async () => {
    const root = await temporaryRoot();
    process.env.PAPOT_STORAGE_MODE = "local";
    process.env.PAPOT_LOCAL_FILES_PATH = root;

    const store = getServerFileStore();
    expect(store.rootPath).toBe(path.resolve(root));
    await expect(store.assertReady()).resolves.toBeUndefined();
  });
});
