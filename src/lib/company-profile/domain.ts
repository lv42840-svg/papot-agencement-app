import { z } from "zod";

const shortText = z.string().trim().max(240).default("");
const mediumText = z.string().trim().max(500).default("");
const longText = z.string().trim().max(2_000).default("");

export const companyProfileSchema = z.object({
  name: shortText,
  addressLine1: mediumText,
  postalCode: z.string().trim().max(20).default(""),
  city: shortText,
  legalForm: shortText,
  capital: shortText,
  siret: shortText,
  rcs: shortText,
  ape: shortText,
  vatNumber: shortText,
  phone: shortText,
  email: z.union([z.literal(""), z.string().trim().email().max(240)]).default(""),
  insurerName: mediumText,
  insurerAddress: mediumText,
  insuranceCoverage: longText,
  bankName: mediumText,
  bankAccountHolder: mediumText,
  iban: shortText,
  bic: shortText,
  paymentMethods: mediumText,
  chequePayee: mediumText,
});

export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export function createEmptyCompanyProfile(): CompanyProfile {
  return companyProfileSchema.parse({});
}

export function parseCompanyProfile(value: unknown): CompanyProfile {
  if (value == null) return createEmptyCompanyProfile();
  const parsed = companyProfileSchema.safeParse(value);
  if (!parsed.success) throw new Error("COMPANY_PROFILE_INVALID");
  return parsed.data;
}
