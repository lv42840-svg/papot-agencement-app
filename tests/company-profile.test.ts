import { describe, expect, it } from "vitest";
import {
  createEmptyCompanyProfile,
  parseCompanyProfile,
  type CompanyProfile,
} from "../src/lib/company-profile/domain";
import type { QuoteDocumentCompanyProfile } from "../src/lib/quotes/document-data";

describe("company profile", () => {
  it("creates a complete empty profile without inventing company data", () => {
    const profile = createEmptyCompanyProfile();

    expect(profile.name).toBe("");
    expect(profile.siret).toBe("");
    expect(profile.vatNumber).toBe("");
    expect(profile.insurerName).toBe("");
    expect(profile.iban).toBe("");
    expect(Object.keys(profile)).toHaveLength(21);
  });

  it("normalizes values and remains directly compatible with quote document data", () => {
    const profile: CompanyProfile = parseCompanyProfile({
      name: "  PAPOT TEST  ",
      email: " devis@papot.example ",
      bankName: " Banque Test ",
    });
    const documentProfile: QuoteDocumentCompanyProfile = profile;

    expect(documentProfile.name).toBe("PAPOT TEST");
    expect(documentProfile.email).toBe("devis@papot.example");
    expect(documentProfile.bankName).toBe("Banque Test");
    expect(documentProfile.rcs).toBe("");
  });

  it("rejects an invalid email instead of silently storing it", () => {
    expect(() => parseCompanyProfile({ email: "not-an-email" })).toThrow("COMPANY_PROFILE_INVALID");
  });
});
