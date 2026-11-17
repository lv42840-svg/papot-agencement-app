import { constants } from "node:fs";
import { open, opendir, mkdir, unlink, link } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Linux descriptor-relative traversal: no symlinks, including intermediate
// directories; a concurrent rename cannot redirect an already opened parent.
export function segments(value = "") {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new HttpError(400, "Chemin invalide.");
  }
  const result = value.split("/");
  if (result[0] === "") result.shift();
  if (result.at(-1) === "") result.pop();
  if (
    result.some((part) => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255)
  ) {
    throw new HttpError(400, "Chemin invalide.");
  }
  if (result.some((part) => part.startsWith("."))) {
    throw new HttpError(403, "Les fichiers techniques masqués ne sont pas accessibles.");
  }
  return result;
}

export async function directory(root, parts) {
  let handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of parts) {
      const next = await open(
        `/proc/self/fd/${handle.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await handle.close();
      handle = next;
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function listFiles(root, path) {
  const parent = await directory(root, segments(path));
  try {
    const entries = [];
    const dir = await opendir(`/proc/self/fd/${parent.fd}`);
    let truncated = false;
    for await (const item of dir) {
      if (item.name.startsWith(".") || (!item.isDirectory() && !item.isFile())) continue;
      if (entries.length >= 5000) {
        truncated = true;
        break;
      }
      let handle;
      try {
        handle = await open(
          `/proc/self/fd/${parent.fd}/${item.name}`,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const stat = await handle.stat();
        if (stat.isDirectory() || stat.isFile())
          entries.push({
            name: item.name,
            directory: stat.isDirectory(),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
      } catch (error) {
        if (!["ENOENT", "ELOOP", "EACCES", "EPERM"].includes(error.code)) throw error;
      } finally {
        await handle?.close();
      }
    }
    entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, "fr", { numeric: true }),
    );
    return { entries, truncated };
  } finally {
    await parent.close();
  }
}

export async function openFile(root, path) {
  const parts = segments(path);
  const name = parts.pop();
  if (!name) throw new HttpError(400, "Choisissez un fichier.");
  const parent = await directory(root, parts);
  try {
    const handle = await open(
      `/proc/self/fd/${parent.fd}/${name}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      throw new HttpError(400, "Ce fichier ne peut pas être ouvert.");
    }
    return { handle, stat, name };
  } finally {
    await parent.close();
  }
}

export async function createFolder(root, path, name) {
  if (segments(name).length !== 1 || name.includes("/"))
    throw new HttpError(400, "Nom de dossier invalide.");
  const parent = await directory(root, segments(path));
  try {
    await mkdir(`/proc/self/fd/${parent.fd}/${name}`, { mode: 0o770 });
  } finally {
    await parent.close();
  }
}

export async function uploadFile(root, path, name, stream, maxBytes) {
  if (segments(name).length !== 1 || name.includes("/"))
    throw new HttpError(400, "Nom de fichier invalide.");
  const parent = await directory(root, segments(path));
  const base = `/proc/self/fd/${parent.fd}`;
  const temporary = `${base}/.papot-upload-${randomUUID()}`;
  let size = 0;
  try {
    const handle = await open(temporary, "wx", 0o660);
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(size > maxBytes ? new HttpError(413, "Fichier trop volumineux.") : null, chunk);
      },
    });
    await pipeline(stream, limiter, handle.createWriteStream());
    // Atomic no-clobber publication. Never replace a file used by either app.
    await link(temporary, `${base}/${name}`);
    return size;
  } finally {
    await unlink(temporary).catch(() => {});
    await parent.close();
  }
}

const types = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};
export function previewType(name) {
  return types[name.slice(name.lastIndexOf(".")).toLowerCase()] || null;
}

export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new HttpError(416, "Plage invalide.");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    throw new HttpError(416, "Plage invalide.");
  return { start, end };
}
