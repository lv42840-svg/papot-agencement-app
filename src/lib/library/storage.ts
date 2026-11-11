import { z } from "zod";
import {
  libraryComponentSchema,
  parseLibraryComponent,
  type LibraryComponent,
} from "./component";
import {
  libraryOuvrageSchema,
  parseLibraryOuvrage,
  type LibraryOuvrage,
} from "./ouvrage";

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

function ensureUniqueIds(
  elements: Array<{ id: string }>,
  codeErreur: string,
): void {
  const identifiants = new Set<string>();
  for (const element of elements) {
    if (identifiants.has(element.id)) throw new Error(codeErreur);
    identifiants.add(element.id);
  }
}

function validateComponentReferences(
  composants: LibraryComponent[],
  ouvrages: LibraryOuvrage[],
): void {
  const identifiantsComposants = new Set(
    composants.map((composant) => composant.id),
  );
  for (const ouvrage of ouvrages) {
    for (const ligne of ouvrage.components) {
      if (!identifiantsComposants.has(ligne.componentId)) {
        throw new Error(
          "LIBRARY_OUVRAGE_COMPONENT_NOT_FOUND",
        );
      }
    }
  }
}

export function parseLibraryPayload(
  valeur: unknown,
): LibraryPayload {
  if (valeur == null) return createInitialLibraryPayload();

  const analyse = libraryPayloadSchema.safeParse(valeur);
  if (!analyse.success) throw new Error("LIBRARY_STORE_INVALID");

  for (const composant of analyse.data.components) {
    parseLibraryComponent(composant);
  }
  for (const ouvrage of analyse.data.ouvrages) {
    parseLibraryOuvrage(ouvrage);
  }

  ensureUniqueIds(
    analyse.data.components,
    "LIBRARY_COMPONENT_ID_DUPLICATE",
  );
  ensureUniqueIds(
    analyse.data.ouvrages,
    "LIBRARY_OUVRAGE_ID_DUPLICATE",
  );
  validateComponentReferences(
    analyse.data.components,
    analyse.data.ouvrages,
  );

  return analyse.data;
}
