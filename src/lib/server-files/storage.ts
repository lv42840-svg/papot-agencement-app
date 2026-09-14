import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const WINDOWS_INVALID_SEGMENT = /[<>:"|?*\x00-\x1F]/;

export type ServerFileWriteResult = {
  storagePath: string;
  sizeBytes: number;
  sha256: string;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : undefined;
}

export function normalizeServerStoragePath(value: string): string {
  if (typeof value !== "string") throw new Error("SERVER_FILE_PATH_INVALID");
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error("SERVER_FILE_PATH_INVALID");
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        WINDOWS_INVALID_SEGMENT.test(segment) ||
        /[. ]$/.test(segment),
    )
  ) {
    throw new Error("SERVER_FILE_PATH_INVALID");
  }

  return segments.join("/");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ServerFileStore {
  readonly rootPath: string;

  constructor(rootPath: string) {
    if (typeof rootPath !== "string" || !rootPath.trim()) {
      throw new Error("SERVER_FILE_ROOT_REQUIRED");
    }
    if (!path.isAbsolute(rootPath)) throw new Error("SERVER_FILE_ROOT_INVALID");
    this.rootPath = path.resolve(rootPath);
  }

  private resolve(storagePath: string): { logical: string; absolute: string } {
    const logical = normalizeServerStoragePath(storagePath);
    const absolute = path.resolve(this.rootPath, ...logical.split("/"));
    const relative = path.relative(this.rootPath, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("SERVER_FILE_PATH_INVALID");
    }
    return { logical, absolute };
  }

  async assertReady(): Promise<void> {
    try {
      await fs.access(this.rootPath);
    } catch {
      throw new Error("SERVER_FILE_ROOT_UNAVAILABLE");
    }
  }

  async writeBytes(storagePath: string, bytes: Uint8Array): Promise<ServerFileWriteResult> {
    const target = this.resolve(storagePath);
    await fs.mkdir(path.dirname(target.absolute), { recursive: true });

    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let created = false;
    try {
      handle = await fs.open(target.absolute, "wx");
      created = true;
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      if (errorCode(error) === "EEXIST") throw new Error("SERVER_FILE_EXISTS");
      if (created) await fs.unlink(target.absolute).catch(() => undefined);
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }

    return {
      storagePath: target.logical,
      sizeBytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    };
  }

  async readBytes(storagePath: string, expectedSha256?: string): Promise<Buffer> {
    const target = this.resolve(storagePath);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(target.absolute);
    } catch (error) {
      if (errorCode(error) === "ENOENT") throw new Error("SERVER_FILE_NOT_FOUND");
      throw error;
    }

    if (expectedSha256 && sha256Bytes(bytes) !== expectedSha256.toLowerCase()) {
      throw new Error("SERVER_FILE_INTEGRITY_MISMATCH");
    }
    return bytes;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    const target = this.resolve(storagePath);
    try {
      await fs.unlink(target.absolute);
      return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
  }
}
