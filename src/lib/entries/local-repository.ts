import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parseEntriesPayload, type EntriesPayload } from "./domain";
import {
  applyEntriesMutation,
  registerEntryAttachments,
  type EntriesMutationResult,
} from "./mutations";
import type { EntriesRepository } from "./repository";

const RESOURCE_KEY = "entries";

export function createLocalEntriesRepository(): EntriesRepository {
  const enregistrer = (
    transformation: (donnees: EntriesPayload) => EntriesMutationResult,
  ): Promise<EntriesMutationResult> =>
    mutateLocalSnapshot(RESOURCE_KEY, parseEntriesPayload, ({ payload: donnees }) => {
      const mutation = transformation(structuredClone(donnees));
      return { payload: mutation.payload, result: mutation };
    });

  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseEntriesPayload).payload;
    },
    async mutate(saisie, auteur) {
      return enregistrer((donnees) => applyEntriesMutation(donnees, saisie, auteur));
    },
    async registerAttachments(idEntree, piecesJointes, auteur) {
      return enregistrer((donnees) =>
        registerEntryAttachments(donnees, idEntree, piecesJointes, auteur),
      );
    },
  };
}
