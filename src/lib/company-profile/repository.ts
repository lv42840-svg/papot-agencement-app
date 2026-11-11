import type { CompanyProfile } from "./domain";

export interface CompanyProfileRepository {
  load(): Promise<CompanyProfile>;
  replace(profil: CompanyProfile): Promise<CompanyProfile>;
}
