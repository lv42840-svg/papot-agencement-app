import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerFileStore } from "@/lib/server-files/runtime";
import type { ServerFileStore } from "@/lib/server-files/storage";
import {
  applyFolderTemplateAction,
  defaultFolderTemplate,
  validateFolderTemplate,
  type FolderTemplate,
  type FolderTemplateAction,
} from "./folder-template";

const FILE = "chantier-folder-template.json";
let pending: Promise<void> = Promise.resolve();

function location(store?: ServerFileStore) {
  const root = (store ?? getServerFileStore()).rootPath;
  return path.join(root, "_papot_settings", FILE);
}

export async function loadChantierFolderTemplate(store?: ServerFileStore): Promise<FolderTemplate> {
  const filepath = location(store);
  try {
    const json = await fs.readFile(filepath, "utf8");
    return validateFolderTemplate(JSON.parse(json));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultFolderTemplate();
    throw error;
  }
}

/** Serialises administrator edits within one server process and commits via
 * a same-directory atomic rename. A stale client revision is rejected.
 */
export async function mutateChantierFolderTemplate(
  expectedRevision: number,
  action: FolderTemplateAction,
): Promise<FolderTemplate> {
  const previous = pending;
  let release!: () => void;
  pending = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const current = await loadChantierFolderTemplate();
    if (current.revision !== expectedRevision) throw new Error("CHANTIER_TEMPLATE_CONFLICT");
    const next = applyFolderTemplateAction(current, action);
    const filepath = location();
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const temporary = filepath + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, filepath);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    return next;
  } finally {
    release();
  }
}
