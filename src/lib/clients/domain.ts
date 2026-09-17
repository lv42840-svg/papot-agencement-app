import { z } from "zod";
import { DEFAULT_VAT_RATE_PERCENT, vatRatePercentSchema } from "../vat";

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const clientTypeSchema = z.enum(["PARTICULIER", "ENTREPRISE", "COLLECTIVITE", "AUTRE"]);

export const clientContactSchema = z
  .object({
    id: z.string().uuid(),
    firstName: z.string().trim().max(120),
    lastName: z.string().trim().max(120),
    role: z.string().trim().max(160),
    phone: z.string().trim().max(80),
    email: z.union([z.literal(""), z.string().trim().email().max(240)]),
    isPrimary: z.boolean(),
  })
  .superRefine((contact, context) => {
    if (!contact.firstName && !contact.lastName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastName"],
        message: "CONTACT_NAME_REQUIRED",
      });
    }
  });

export const clientRecordSchema = z
  .object({
    id: z.string().uuid(),
    type: clientTypeSchema,
    companyName: z.string().trim().max(240),
    firstName: z.string().trim().max(120),
    lastName: z.string().trim().max(120),
    addressLine1: z.string().trim().max(240),
    addressLine2: z.string().trim().max(240),
    postalCode: z.string().trim().max(20),
    city: z.string().trim().max(160),
    phone: z.string().trim().max(80),
    email: z.union([z.literal(""), z.string().trim().email().max(240)]),
    siret: z.union([z.literal(""), z.string().regex(/^\d{14}$/)]),
    paymentTerms: z.string().trim().max(1000),
    defaultVatRatePercent: vatRatePercentSchema.default(DEFAULT_VAT_RATE_PERCENT),
    notes: z.string().trim().max(4000),
    contacts: z.array(clientContactSchema).max(25),
    isArchived: z.boolean(),
    archivedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    createdByName: z.string().trim().min(1).max(160),
    updatedAt: isoDateTimeSchema,
    updatedByName: z.string().trim().min(1).max(160),
  })
  .superRefine((client, context) => {
    if (client.type === "PARTICULIER") {
      if (!client.lastName) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lastName"],
          message: "CLIENT_LAST_NAME_REQUIRED",
        });
      }
    } else if (!client.companyName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyName"],
        message: "CLIENT_COMPANY_NAME_REQUIRED",
      });
    }

    if (client.contacts.filter((contact) => contact.isPrimary).length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contacts"],
        message: "CLIENT_PRIMARY_CONTACT_DUPLICATE",
      });
    }
  });

export const clientsPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  clients: z.array(clientRecordSchema),
});

export type ClientType = z.infer<typeof clientTypeSchema>;
export type ClientContact = z.infer<typeof clientContactSchema>;
export type ClientRecord = z.infer<typeof clientRecordSchema>;
export type ClientsPayload = z.infer<typeof clientsPayloadSchema>;

export type ClientConfirmationMissingField =
  | "identity"
  | "addressLine1"
  | "postalCode"
  | "city"
  | "siret"
  | "paymentTerms";

export const CLIENT_CONFIRMATION_FIELD_LABELS: Record<ClientConfirmationMissingField, string> = {
  identity: "identité du client",
  addressLine1: "adresse",
  postalCode: "code postal",
  city: "ville",
  siret: "SIRET",
  paymentTerms: "conditions de règlement",
};

export function createInitialClientsPayload(): ClientsPayload {
  return { schemaVersion: 1, clients: [] };
}

export function parseClientsPayload(value: unknown): ClientsPayload {
  if (value == null) return createInitialClientsPayload();
  const parsed = clientsPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("CLIENTS_STORE_INVALID");
  return parsed.data;
}

export function clientDisplayName(client: ClientRecord): string {
  if (client.type === "PARTICULIER") {
    return [client.lastName, client.firstName].filter(Boolean).join(" ");
  }
  return client.companyName;
}

export function clientConfirmationMissingFields(
  client: ClientRecord,
): ClientConfirmationMissingField[] {
  const missing: ClientConfirmationMissingField[] = [];
  if (!clientDisplayName(client).trim()) missing.push("identity");
  if (!client.addressLine1.trim()) missing.push("addressLine1");
  if (!client.postalCode.trim()) missing.push("postalCode");
  if (!client.city.trim()) missing.push("city");
  if (client.type !== "PARTICULIER" && !client.siret.trim()) missing.push("siret");
  if (!client.paymentTerms.trim()) missing.push("paymentTerms");
  return missing;
}

export function isClientReadyForConfirmation(client: ClientRecord): boolean {
  return !client.isArchived && clientConfirmationMissingFields(client).length === 0;
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

export function clientSearchText(client: ClientRecord): string {
  return normalizeSearchValue(
    [
      clientDisplayName(client),
      client.companyName,
      client.firstName,
      client.lastName,
      client.phone,
      client.email,
      client.siret,
      client.addressLine1,
      client.addressLine2,
      client.postalCode,
      client.city,
      ...client.contacts.flatMap((contact) => [
        contact.firstName,
        contact.lastName,
        contact.role,
        contact.phone,
        contact.email,
      ]),
    ].join(" "),
  );
}

export function matchesClientSearch(client: ClientRecord, query: string): boolean {
  const terms = normalizeSearchValue(query)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = clientSearchText(client);
  return terms.every((term) => haystack.includes(term));
}
