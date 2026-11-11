import "server-only";

import { readLocalSnapshot, replaceLocalSnapshot } from "@/lib/local-db/runtime";
import { parseCompanyProfile, type CompanyProfile } from "./domain";
import type { CompanyProfileRepository } from "./repository";

const RESOURCE_KEY = "company-profile";

export function createLocalCompanyProfileRepository(): CompanyProfileRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseCompanyProfile).payload;
    },

    async replace(profil: CompanyProfile) {
      const sauvegarde = await replaceLocalSnapshot(
        RESOURCE_KEY,
        parseCompanyProfile,
        profil,
      );
      return sauvegarde.payload;
    },
  };
}
