import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_VAT_RATE_PERCENT, vatRatePercentSchema } from "@/lib/vat";
import {
  clientContactSchema,
  clientRecordSchema,
  clientTypeSchema,
  type ClientContact,
  type ClientRecord,
  type ClientsPayload,
} from "./domain";

const optionalEmailSchema = z.union([z.literal(""), z.string().trim().email().max(240)]);
const optionalSiretSchema = z
  .string()
  .trim()
  .max(30)
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => value === "" || /^\d{14}$/.test(value), "CLIENT_SIRET_INVALID");

const contactInputSchema = z.object({
  id: z.string().uuid().optional(),
  firstName: z.string().trim().max(120).default(""),
  lastName: z.string().trim().max(120).default(""),
  role: z.string().trim().max(160).default(""),
  phone: z.string().trim().max(80).default(""),
  email: optionalEmailSchema.default(""),
  isPrimary: z.boolean().default(false),
});

const writableClientFields = {
  type: clientTypeSchema,
  companyName: z.string().trim().max(240).default(""),
  firstName: z.string().trim().max(120).default(""),
  lastName: z.string().trim().max(120).default(""),
  addressLine1: z.string().trim().max(240).default(""),
  addressLine2: z.string().trim().max(240).default(""),
  postalCode: z.string().trim().max(20).default(""),
  city: z.string().trim().max(160).default(""),
  phone: z.string().trim().max(80).default(""),
  email: optionalEmailSchema.default(""),
  siret: optionalSiretSchema.default(""),
  paymentTerms: z.string().trim().max(1000).default(""),
  defaultVatRatePercent: vatRatePercentSchema.optional(),
  notes: z.string().trim().max(4000).default(""),
  contacts: z.array(contactInputSchema).max(25).default([]),
};

export const clientsMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    clientId: z.string().uuid().optional(),
    ...writableClientFields,
  }),
  z.object({
    action: z.literal("update"),
    clientId: z.string().uuid(),
    ...writableClientFields,
  }),
  z.object({
    action: z.literal("updateVat"),
    clientId: z.string().uuid(),
    defaultVatRatePercent: vatRatePercentSchema,
  }),
  z.object({ action: z.literal("archive"), clientId: z.string().uuid() }),
  z.object({ action: z.literal("reactivate"), clientId: z.string().uuid() }),
]);

export type ClientsMutation = z.infer<typeof clientsMutationSchema>;
export type ClientsActor = { userId: string; displayName: string };
export type ClientsMutationResult = { payload: ClientsPayload; focusClientId?: string };

type WritableMutation = Extract<ClientsMutation, { action: "create" | "update" }>;

function findClient(payload: ClientsPayload, clientId: string): ClientRecord {
  const client = payload.clients.find((candidate) => candidate.id === clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  return client;
}

function normalizeContacts(input: WritableMutation["contacts"]): ClientContact[] {
  const contacts = input.map((contact) =>
    clientContactSchema.parse({
      ...contact,
      id: contact.id ?? randomUUID(),
    }),
  );

  if (contacts.filter((contact) => contact.isPrimary).length > 1) {
    throw new Error("CLIENT_PRIMARY_CONTACT_DUPLICATE");
  }

  return contacts;
}

function ensureUniqueSiret(payload: ClientsPayload, siret: string, exceptClientId?: string): void {
  if (!siret) return;
  if (
    payload.clients.some(
      (client) => client.id !== exceptClientId && client.siret !== "" && client.siret === siret,
    )
  ) {
    throw new Error("CLIENT_SIRET_EXISTS");
  }
}

function writableValues(input: WritableMutation, existing?: ClientRecord) {
  return {
    type: input.type,
    companyName: input.companyName,
    firstName: input.firstName,
    lastName: input.lastName,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    postalCode: input.postalCode,
    city: input.city,
    phone: input.phone,
    email: input.email,
    siret: input.siret,
    paymentTerms: input.paymentTerms,
    defaultVatRatePercent:
      input.defaultVatRatePercent ?? existing?.defaultVatRatePercent ?? DEFAULT_VAT_RATE_PERCENT,
    notes: input.notes,
    contacts: normalizeContacts(input.contacts),
  };
}

function parseBusinessClient(candidate: ClientRecord): ClientRecord {
  const parsed = clientRecordSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues.find((item) => item.code === "custom");
  if (issue?.message) throw new Error(issue.message);
  throw new Error("CLIENT_REQUEST_INVALID");
}

export function applyClientsMutation(
  source: ClientsPayload,
  input: ClientsMutation,
  actor: ClientsActor,
  nowDate: Date = new Date(),
): ClientsMutationResult {
  const payload = structuredClone(source);
  const now = nowDate.toISOString();

  if (input.action === "create") {
    ensureUniqueSiret(payload, input.siret);
    const client = parseBusinessClient({
      id: input.clientId ?? randomUUID(),
      ...writableValues(input),
      isArchived: false,
      archivedAt: null,
      createdAt: now,
      createdByName: actor.displayName,
      updatedAt: now,
      updatedByName: actor.displayName,
    });
    payload.clients.unshift(client);
    return { payload, focusClientId: client.id };
  }

  const client = findClient(payload, input.clientId);

  if (input.action === "update") {
    if (client.isArchived) throw new Error("CLIENT_ARCHIVED");
    ensureUniqueSiret(payload, input.siret, client.id);
    const updated = parseBusinessClient({
      ...client,
      ...writableValues(input, client),
      updatedAt: now,
      updatedByName: actor.displayName,
    });
    const index = payload.clients.findIndex((candidate) => candidate.id === client.id);
    payload.clients[index] = updated;
    return { payload, focusClientId: updated.id };
  }

  if (input.action === "updateVat") {
    if (client.isArchived) throw new Error("CLIENT_ARCHIVED");
    const updated = parseBusinessClient({
      ...client,
      defaultVatRatePercent: input.defaultVatRatePercent,
      updatedAt: now,
      updatedByName: actor.displayName,
    });
    const index = payload.clients.findIndex((candidate) => candidate.id === client.id);
    payload.clients[index] = updated;
    return { payload, focusClientId: updated.id };
  }

  if (input.action === "archive") {
    if (!client.isArchived) {
      client.isArchived = true;
      client.archivedAt = now;
      client.updatedAt = now;
      client.updatedByName = actor.displayName;
    }
    return { payload, focusClientId: client.id };
  }

  if (input.action === "reactivate") {
    if (client.isArchived) {
      client.isArchived = false;
      client.archivedAt = null;
      client.updatedAt = now;
      client.updatedByName = actor.displayName;
    }
    return { payload, focusClientId: client.id };
  }

  throw new Error("CLIENT_MUTATION_UNSUPPORTED");
}
