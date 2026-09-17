import type { CompanyProfile } from "./domain";

export interface CompanyProfileRepository {
  load(): Promise<CompanyProfile>;
  replace(profile: CompanyProfile): Promise<CompanyProfile>;
}
