import { z } from "zod";
import type { ClientRecord, ClientType } from "@/lib/clients/domain";

const customerSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    customer_type: z.enum(["company", "individual"]),
    name: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    vat_number: z.string().nullish(),
    reg_no: z.string().nullish(),
    electronic_billing_address: z.string().nullish(),
    public_administration: z.boolean().nullish(),
    phone: z.string().nullish(),
    emails: z.array(z.string()).nullish(),
    payment_conditions: z.string().nullish(),
    updated_at: z.string().nullish(),
    billing_address: z
      .object({
        address: z.string().nullish(),
        postal_code: z.string().nullish(),
        city: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough();

const terms: Record<string, string> = {
  upon_receipt: "À réception de facture",
  "7_days": "7 jours date de facture",
  "15_days": "15 jours date de facture",
  "30_days": "30 jours date de facture",
  "30_days_end_of_month": "30 jours fin de mois",
  "45_days": "45 jours date de facture",
  "45_days_end_of_month": "45 jours fin de mois",
  "60_days": "60 jours date de facture",
  "60_days_end_of_month": "60 jours fin de mois",
};

function trim(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function customerSiret(regNo: string, electronicAddress: string): string {
  if (/^\d{14}$/.test(regNo)) return regNo;
  // Pennylane represents a French billing establishment as SIREN_NIC.
  const match = /^(\d{9})_(\d{5})$/.exec(electronicAddress);
  if (!match) return "";
  if (regNo && /^\d{9}$/.test(regNo) && match[1] !== regNo) return "";
  return match[1] + match[2];
}

export type PennylaneCustomerFields = Pick<
  ClientRecord,
  | "type"
  | "companyName"
  | "firstName"
  | "lastName"
  | "addressLine1"
  | "addressLine2"
  | "postalCode"
  | "city"
  | "phone"
  | "email"
  | "siret"
  | "vatNumber"
  | "paymentTerms"
>;

export type PennylaneCustomer = {
  id: string;
  name: string;
  updatedAt: string | null;
  fields: PennylaneCustomerFields;
};

export function normalizePennylaneCustomer(input: unknown): PennylaneCustomer {
  const result = customerSchema.safeParse(input);
  if (!result.success) throw new Error("PENNYLANE_CUSTOMER_DATA_INVALID");
  const raw = result.data;
  const id = String(raw.id);
  if (!/^\d{1,20}$/.test(id)) throw new Error("PENNYLANE_CUSTOMER_DATA_INVALID");
  const individual = raw.customer_type === "individual";
  const firstName = individual ? trim(raw.first_name, 120) : "";
  const lastName = individual ? trim(raw.last_name, 120) : "";
  const companyName = individual ? "" : trim(raw.name, 240);
  if ((individual && !lastName) || (!individual && !companyName)) {
    throw new Error("PENNYLANE_CUSTOMER_DATA_INVALID");
  }
  const email = (raw.emails ?? []).find((item) => z.string().email().safeParse(item).success) ?? "";
  const regNo = trim(raw.reg_no, 20);
  const siret = individual ? "" : customerSiret(regNo, trim(raw.electronic_billing_address, 70));
  const type: ClientType = individual
    ? "PARTICULIER"
    : raw.public_administration
      ? "COLLECTIVITE"
      : "ENTREPRISE";
  const fields: PennylaneCustomerFields = {
    type,
    companyName,
    firstName,
    lastName,
    addressLine1: trim(raw.billing_address?.address, 240),
    addressLine2: "",
    postalCode: trim(raw.billing_address?.postal_code, 20),
    city: trim(raw.billing_address?.city, 160),
    phone: trim(raw.phone, 80),
    email: trim(email, 240),
    siret,
    vatNumber: trim(raw.vat_number, 40),
    paymentTerms: terms[raw.payment_conditions ?? ""] ?? "",
  };
  return {
    id,
    name: individual ? [firstName, lastName].filter(Boolean).join(" ") : companyName,
    updatedAt: raw.updated_at ?? null,
    fields,
  };
}

export function normalizedClientIdentity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function possibleClientMatches(
  candidate: PennylaneCustomer,
  existing: readonly ClientRecord[],
): ClientRecord[] {
  const name = normalizedClientIdentity(candidate.name);
  return existing.filter(
    (client) =>
      (candidate.fields.siret !== "" && client.siret === candidate.fields.siret) ||
      (name !== "" &&
        normalizedClientIdentity(
          client.type === "PARTICULIER"
            ? [client.firstName, client.lastName].join(" ")
            : client.companyName,
        ) === name),
  );
}

/**
 * Pennylane is the master of business identity. PAPOT retains local-only
 * notes, contacts, VAT preferences, archive state, UUID and history.
 */
export function mergePennylaneIdentity(
  current: ClientRecord,
  customer: PennylaneCustomer,
  actor: string,
  now = new Date(),
): ClientRecord {
  if (current.pennylaneId && current.pennylaneId !== customer.id) {
    throw new Error("PENNYLANE_CLIENT_LINK_CONFLICT");
  }
  if (current.siret && customer.fields.siret && current.siret !== customer.fields.siret) {
    throw new Error("PENNYLANE_CLIENT_SIRET_CONFLICT");
  }
  return {
    ...current,
    ...customer.fields,
    // Provider may have no usable SIRET/payment schedule: preserve any
    // existing explicitly-entered value rather than erasing it.
    siret: customer.fields.siret || current.siret,
    paymentTerms: customer.fields.paymentTerms || current.paymentTerms,
    pennylaneId: customer.id,
    updatedAt: now.toISOString(),
    updatedByName: actor,
  };
}
