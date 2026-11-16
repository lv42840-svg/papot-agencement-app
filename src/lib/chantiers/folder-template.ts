import { randomUUID } from "node:crypto";
import { z } from "zod";

export const DEFAULT_CHANTIER_FOLDER_PATHS = [
  "Administratif",
  "Devis-Chiffrage",
  "Devis-Chiffrage/Documents reçus",
  "Devis-Chiffrage/Chiffrage interne",
  "Devis-Chiffrage/Devis",
  "Devis-Chiffrage/Déboursé",
  "Devis-Chiffrage/Divers",
  "Documents chantier",
  "Documents chantier/Plans",
  "Documents chantier/Plannings",
  "Documents chantier/Documents architecte - MOE",
  "Documents chantier/Divers",
  "BE - Atelier",
  "BE - Atelier/TOP",
  "BE - Atelier/DFT",
  "BE - Atelier/DXF",
  "BE - Atelier/Débit",
  "BE - Atelier/Documents divers",
  "BE - Atelier/Programme CN",
  "Atelier",
  "Pose",
  "Réunions",
  "Mails",
  "Réception",
  "SAV",
] as const;

export const folderNodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
  parentId: z.string().min(1).max(80).nullable(),
  name: z.string().trim().min(1).max(80),
});

export const folderTemplateSchema = z.object({
  revision: z.number().int().min(1),
  folders: z.array(folderNodeSchema).min(DEFAULT_CHANTIER_FOLDER_PATHS.length).max(150),
});
export type FolderNode = z.infer<typeof folderNodeSchema>;
export type FolderTemplate = z.infer<typeof folderTemplateSchema>;

export const folderTemplateActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), parentId: z.string().nullable(), name: z.string() }),
  z.object({ action: z.literal("rename"), id: z.string(), name: z.string() }),
  z.object({ action: z.literal("move"), id: z.string(), parentId: z.string().nullable() }),
  z.object({ action: z.literal("reorder"), id: z.string(), direction: z.enum(["up", "down"]) }),
]);
export type FolderTemplateAction = z.infer<typeof folderTemplateActionSchema>;

export function defaultFolderTemplate(): FolderTemplate {
  const byPath = new Map<string, string>();
  const folders: FolderNode[] = DEFAULT_CHANTIER_FOLDER_PATHS.map((folderPath, index) => {
    const parts = folderPath.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const id = "standard-" + String(index + 1).padStart(3, "0");
    const parentId = parentPath ? (byPath.get(parentPath) ?? null) : null;
    byPath.set(folderPath, id);
    return { id, parentId, name: parts[parts.length - 1] };
  });
  return { revision: 1, folders };
}

function validateSegment(segment: string) {
  if (
    segment !== segment.trim() ||
    !segment ||
    /[<>:"/\\|?*\x00-\x1F]/.test(segment) ||
    /[. ]$/.test(segment) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(segment)
  ) {
    throw new Error("CHANTIER_TEMPLATE_NAME_INVALID");
  }
}

export function validateFolderTemplate(input: unknown): FolderTemplate {
  const result = folderTemplateSchema.parse(input);
  const byId = new Map(result.folders.map((folder) => [folder.id, folder]));
  if (byId.size !== result.folders.length) throw new Error("CHANTIER_TEMPLATE_DUPLICATE_ID");
  const defaults = defaultFolderTemplate();
  if (defaults.folders.some((folder) => !byId.has(folder.id))) {
    throw new Error("CHANTIER_TEMPLATE_SYSTEM_FOLDER_REQUIRED");
  }
  const siblings = new Set<string>();
  for (const folder of result.folders) {
    validateSegment(folder.name);
    if (folder.parentId && !byId.has(folder.parentId)) {
      throw new Error("CHANTIER_TEMPLATE_PARENT_NOT_FOUND");
    }
    const identity = (folder.parentId ?? "ROOT") + "/" + folder.name.toLocaleLowerCase("fr-FR");
    if (siblings.has(identity)) throw new Error("CHANTIER_TEMPLATE_DUPLICATE_NAME");
    siblings.add(identity);
    const visited = new Set([folder.id]);
    let current = folder;
    while (current.parentId) {
      if (visited.has(current.parentId)) throw new Error("CHANTIER_TEMPLATE_CYCLE");
      visited.add(current.parentId);
      if (visited.size > 7) throw new Error("CHANTIER_TEMPLATE_TOO_DEEP");
      current = byId.get(current.parentId)!;
    }
  }
  return result;
}

export function folderNodePath(template: FolderTemplate, folderId: string): string {
  const byId = new Map(template.folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  let cursor: string | null = folderId;
  while (cursor) {
    const node = byId.get(cursor);
    if (!node) throw new Error("CHANTIER_TEMPLATE_FOLDER_NOT_FOUND");
    parts.unshift(node.name);
    cursor = node.parentId;
  }
  return parts.join("/");
}

export function folderTemplatePaths(template: FolderTemplate): string[] {
  return template.folders.map((folder) => folderNodePath(template, folder.id));
}

export function canonicalFolderPath(template: FolderTemplate, defaultPath: string): string {
  const index = DEFAULT_CHANTIER_FOLDER_PATHS.findIndex((item) => item === defaultPath);
  if (index < 0) throw new Error("CHANTIER_TEMPLATE_ROLE_UNKNOWN");
  return folderNodePath(template, "standard-" + String(index + 1).padStart(3, "0"));
}

export function applyFolderTemplateAction(
  input: FolderTemplate,
  rawAction: FolderTemplateAction,
): FolderTemplate {
  const previous = validateFolderTemplate(input);
  const action = folderTemplateActionSchema.parse(rawAction);
  const folders = previous.folders.map((folder) => ({ ...folder }));
  if (action.action === "add") {
    if (folders.length >= 150) throw new Error("CHANTIER_TEMPLATE_TOO_MANY");
    folders.push({
      id: randomUUID().replace(/-/g, ""),
      parentId: action.parentId,
      name: action.name.trim(),
    });
  } else {
    const index = folders.findIndex((folder) => folder.id === action.id);
    if (index < 0) throw new Error("CHANTIER_TEMPLATE_FOLDER_NOT_FOUND");
    if (action.action === "rename") {
      folders[index].name = action.name.trim();
    } else if (action.action === "move") {
      folders[index].parentId = action.parentId;
    } else {
      const peerPositions = folders
        .map((node, position) => (node.parentId === folders[index].parentId ? position : -1))
        .filter((position) => position !== -1);
      const current = peerPositions.indexOf(index);
      const swap = peerPositions[current + (action.direction === "up" ? -1 : 1)];
      if (swap !== undefined) [folders[index], folders[swap]] = [folders[swap], folders[index]];
    }
  }
  return validateFolderTemplate({ revision: previous.revision + 1, folders });
}
