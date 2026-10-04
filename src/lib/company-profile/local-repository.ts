import "server-only";

import {
  mutateLocalSnapshot,
  readLocalSnapshot,
  replaceLocalSnapshot,
} from "@/lib/local-db/runtime";
import { parseCompanyProfile, type CompanyProfile } from "./domain";
import type { CompanyProfileRepository } from "./repository";

const RESOURCE_KEY = "company-profile";

export function createLocalCompanyProfileRepository(): CompanyProfileRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseCompanyProfile).payload;
    },

    async loadSnapshot() {
      const snapshot = readLocalSnapshot(RESOURCE_KEY, parseCompanyProfile);
      return { version: snapshot.version, profile: snapshot.payload };
    },

    async replace(profile: CompanyProfile) {
      const saved = await replaceLocalSnapshot(RESOURCE_KEY, parseCompanyProfile, profile);
      return saved.payload;
    },

    async replaceIfVersion(profile: CompanyProfile, expectedVersion: number) {
      return mutateLocalSnapshot(
        RESOURCE_KEY,
        parseCompanyProfile,
        (snapshot) => {
          if (snapshot.version !== expectedVersion) {
            throw new Error("COMPANY_PROFILE_VERSION_CONFLICT");
          }
          const parsed = parseCompanyProfile(profile);
          return {
            payload: parsed,
            result: { version: snapshot.version + 1, profile: parsed },
          };
        },
      );
    },
  };
}
