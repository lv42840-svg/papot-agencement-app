import type { CompanyProfile } from "./domain";

export type CompanyProfileSnapshot = {
  version: number;
  profile: CompanyProfile;
};

export interface CompanyProfileRepository {
  load(): Promise<CompanyProfile>;
  loadSnapshot(): Promise<CompanyProfileSnapshot>;
  replace(profile: CompanyProfile): Promise<CompanyProfile>;
  replaceIfVersion(
    profile: CompanyProfile,
    expectedVersion: number,
  ): Promise<CompanyProfileSnapshot>;
}
