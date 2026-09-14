import { z } from "zod";
import type { SharedResourceEnvelope } from "../sync/resource-lock";
import type {
  NextcloudSharedResourceStore,
  SharedResourceActor,
} from "../sync/resource-state-store";
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

export type SaveLibraryResult =
  | { status: "saved"; library: LibrarySnapshot }
  | { status: "conflict"; current: LibrarySnapshot | null };

type LibraryResourceStore = Pick<NextcloudSharedResourceStore, "get" | "save">;

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

function snapshotFromEnvelope(envelope: SharedResourceEnvelope): LibrarySnapshot {
  if (
    envelope.resource.resource_type !== LIBRARY_RESOURCE_REF.resource_type ||
    envelope.resource.resource_id !== LIBRARY_RESOURCE_REF.resource_id
  ) {
    throw new Error("LIBRARY_RESOURCE_MISMATCH");
  }

  return {
    version: envelope.version,
    payload: parseLibraryPayload(envelope.payload),
  };
}

export class NextcloudLibraryStore {
  constructor(private readonly resources: LibraryResourceStore) {}

  async get(): Promise<LibrarySnapshot> {
    const envelope = await this.resources.get(LIBRARY_RESOURCE_REF);
    if (!envelope) {
      return {
        version: 0,
        payload: createInitialLibraryPayload(),
      };
    }
    return snapshotFromEnvelope(envelope);
  }

  async save(params: {
    expectedVersion: number;
    payload: unknown;
    actor: SharedResourceActor;
    now?: Date;
  }): Promise<SaveLibraryResult> {
    const payload = parseLibraryPayload(params.payload);
    const result = await this.resources.save({
      resource: LIBRARY_RESOURCE_REF,
      expectedVersion: params.expectedVersion,
      payload,
      actor: params.actor,
      now: params.now,
    });

    if (result.status === "saved") {
      return {
        status: "saved",
        library: snapshotFromEnvelope(result.resource),
      };
    }

    return {
      status: "conflict",
      current: result.current ? snapshotFromEnvelope(result.current) : null,
    };
  }
}
