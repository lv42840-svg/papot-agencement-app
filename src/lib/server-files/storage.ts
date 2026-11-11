import "server-only";

import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

const WINDOWS_INVALID_SEGMENT = /[<>:"|?*\x00-\x1F]/;

export type ServerFileWriteResult = {
  storagePath: string;
  sizeBytes: number;
  sha256: string;
};

function errorCode(erreur: unknown): string | undefined {
  return typeof erreur === "object" && erreur !== null && "code" in erreur
    ? String((erreur as { code?: unknown }).code ?? "")
    : undefined;
}

export function normalizeServerStoragePath(valeur: string): string {
  if (typeof valeur !== "string") {
    throw new Error("SERVER_FILE_PATH_INVALID");
  }
  const normalise = valeur.trim().replace(/\\/g, "/");
  if (!normalise || normalise.startsWith("/") || /^[A-Za-z]:/.test(normalise)) {
    throw new Error("SERVER_FILE_PATH_INVALID");
  }

  const segments = normalise.split("/");
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

export function sha256Bytes(octets: Uint8Array): string {
  return createHash("sha256").update(octets).digest("hex");
}

export class ServerFileStore {
  readonly rootPath: string;

  constructor(cheminRacine: string) {
    if (typeof cheminRacine !== "string" || !cheminRacine.trim()) {
      throw new Error("SERVER_FILE_ROOT_REQUIRED");
    }
    if (!path.isAbsolute(cheminRacine)) {
      throw new Error("SERVER_FILE_ROOT_INVALID");
    }
    this.rootPath = path.resolve(cheminRacine);
  }

  private resolve(cheminStockage: string): { logical: string; absolute: string } {
    const logique = normalizeServerStoragePath(cheminStockage);
    const absolu = path.resolve(this.rootPath, ...logique.split("/"));
    const relatif = path.relative(this.rootPath, absolu);
    if (!relatif || relatif.startsWith("..") || path.isAbsolute(relatif)) {
      throw new Error("SERVER_FILE_PATH_INVALID");
    }
    return { logical: logique, absolute: absolu };
  }

  async assertReady(): Promise<void> {
    try {
      await fs.access(this.rootPath, constants.R_OK | constants.W_OK);
    } catch {
      throw new Error("SERVER_FILE_ROOT_UNAVAILABLE");
    }
  }

  async writeBytes(cheminStockage: string, octets: Uint8Array): Promise<ServerFileWriteResult> {
    const cible = this.resolve(cheminStockage);
    await fs.mkdir(path.dirname(cible.absolute), {
      recursive: true,
    });

    let fichierOuvert: Awaited<ReturnType<typeof fs.open>> | undefined;
    let cree = false;
    try {
      fichierOuvert = await fs.open(cible.absolute, "wx");
      cree = true;
      await fichierOuvert.writeFile(octets);
      await fichierOuvert.sync();
    } catch (erreur) {
      if (errorCode(erreur) === "EEXIST") {
        throw new Error("SERVER_FILE_EXISTS");
      }
      if (cree) {
        await fichierOuvert?.close().catch(() => undefined);
        fichierOuvert = undefined;
        await fs.unlink(cible.absolute).catch(() => undefined);
      }
      throw erreur;
    } finally {
      await fichierOuvert?.close().catch(() => undefined);
    }

    return {
      storagePath: cible.logical,
      sizeBytes: octets.byteLength,
      sha256: sha256Bytes(octets),
    };
  }

  async readBytes(cheminStockage: string, sha256Attendu?: string): Promise<Buffer> {
    const cible = this.resolve(cheminStockage);
    let octets: Buffer;
    try {
      octets = await fs.readFile(cible.absolute);
    } catch (erreur) {
      if (errorCode(erreur) === "ENOENT") {
        throw new Error("SERVER_FILE_NOT_FOUND");
      }
      throw erreur;
    }

    if (sha256Attendu && sha256Bytes(octets) !== sha256Attendu.toLowerCase()) {
      throw new Error("SERVER_FILE_INTEGRITY_MISMATCH");
    }
    return octets;
  }

  async deleteFile(cheminStockage: string): Promise<boolean> {
    const cible = this.resolve(cheminStockage);
    try {
      await fs.unlink(cible.absolute);
      return true;
    } catch (erreur) {
      if (errorCode(erreur) === "ENOENT") return false;
      throw erreur;
    }
  }
}
