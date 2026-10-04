import { z } from "zod";
import { libraryComponentSchema, parseLibraryComponent, type LibraryComponent } from "./component";
import { libraryOuvrageSchema, parseLibraryOuvrage, type LibraryOuvrage } from "./ouvrage";

export const LIBRARY_STORAGE_SCHEMA_VERSION = 1 as const;

export const LIBRARY_RESOURCE_REF = {
  resource_type: "LIBRARY",
  resource_id: "catalog",
} as const;

export const libraryPayloadSchema = z
  .object({
    schemaVersion: z.literal(LIBRARY_STORAGE_SCHEMA_VERSION),
    components: z.array(libraryComponentSchema),
    ouvrages: z.array(libraryOuvrageSchema),
  })
  .strict();

export type LibraryPayload = z.infer<typeof libraryPayloadSchema>;
export type LibrarySnapshot = {
  version: number;
  payload: LibraryPayload;
};

export function createInitialLibraryPayload(): LibraryPayload {
  return {
    schemaVersion: LIBRARY_STORAGE_SCHEMA_VERSION,
    components: [],
    ouvrages: [],
  };
}

function ensureUniqueIds(items: Array<{ id: string }>, errorCode: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(errorCode);
    ids.add(item.id);
  }
}

function validateComponentReferences(
  components: LibraryComponent[],
  ouvrages: LibraryOuvrage[],
): void {
  const componentIds = new Set(components.map((component) => component.id));
  for (const ouvrage of ouvrages) {
    for (const line of ouvrage.components) {
      if (!componentIds.has(line.componentId)) {
        throw new Error("LIBRARY_OUVRAGE_COMPONENT_NOT_FOUND");
      }
    }
  }
}

export function parseLibraryPayload(value: unknown): LibraryPayload {
  if (value == null) return createInitialLibraryPayload();

  const parsed = libraryPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("LIBRARY_STORE_INVALID");

  for (const component of parsed.data.components) parseLibraryComponent(component);
  for (const ouvrage of parsed.data.ouvrages) parseLibraryOuvrage(ouvrage);

  ensureUniqueIds(parsed.data.components, "LIBRARY_COMPONENT_ID_DUPLICATE");
  ensureUniqueIds(parsed.data.ouvrages, "LIBRARY_OUVRAGE_ID_DUPLICATE");
  validateComponentReferences(parsed.data.components, parsed.data.ouvrages);

  return parsed.data;
}
