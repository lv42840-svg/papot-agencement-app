import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_VAT_RATE_PERCENT, vatRatePercentSchema } from "../vat";
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
  .transform((valeur) => valeur.replace(/\s+/g, ""))
  .refine((valeur) => valeur === "" || /^\d{14}$/.test(valeur), "CLIENT_SIRET_INVALID");

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
  vatNumber: z.string().trim().max(40).optional(),
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

function findClient(contenu: ClientsPayload, idClient: string): ClientRecord {
  const client = contenu.clients.find((candidat) => candidat.id === idClient);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  return client;
}

function normalizeContacts(saisie: WritableMutation["contacts"]): ClientContact[] {
  const contacts = saisie.map((contact) =>
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

function ensureUniqueSiret(contenu: ClientsPayload, siret: string, exceptClientId?: string): void {
  if (!siret) return;
  if (
    contenu.clients.some(
      (client) => client.id !== exceptClientId && client.siret !== "" && client.siret === siret,
    )
  ) {
    throw new Error("CLIENT_SIRET_EXISTS");
  }
}

function writableValues(saisie: WritableMutation, existing?: ClientRecord) {
  return {
    type: saisie.type,
    companyName: saisie.companyName,
    firstName: saisie.firstName,
    lastName: saisie.lastName,
    addressLine1: saisie.addressLine1,
    addressLine2: saisie.addressLine2,
    postalCode: saisie.postalCode,
    city: saisie.city,
    phone: saisie.phone,
    email: saisie.email,
    siret: saisie.siret,
    vatNumber: saisie.vatNumber ?? existing?.vatNumber ?? "",
    paymentTerms: saisie.paymentTerms,
    defaultVatRatePercent:
      saisie.defaultVatRatePercent ?? existing?.defaultVatRatePercent ?? DEFAULT_VAT_RATE_PERCENT,
    notes: saisie.notes,
    contacts: normalizeContacts(saisie.contacts),
  };
}

function parseBusinessClient(candidat: ClientRecord): ClientRecord {
  const analyse = clientRecordSchema.safeParse(candidat);
  if (analyse.success) return analyse.data;

  const issue = analyse.error.issues.find((element) => element.code === "custom");
  if (issue?.message) throw new Error(issue.message);
  throw new Error("CLIENT_REQUEST_INVALID");
}

export function applyClientsMutation(
  source: ClientsPayload,
  saisie: ClientsMutation,
  auteur: ClientsActor,
  nowDate: Date = new Date(),
): ClientsMutationResult {
  const contenu = structuredClone(source);
  const maintenant = nowDate.toISOString();

  if (saisie.action === "create") {
    ensureUniqueSiret(contenu, saisie.siret);
    const client = parseBusinessClient({
      id: saisie.clientId ?? randomUUID(),
      ...writableValues(saisie),
      isArchived: false,
      archivedAt: null,
      createdAt: maintenant,
      createdByName: auteur.displayName,
      updatedAt: maintenant,
      updatedByName: auteur.displayName,
    });
    contenu.clients.unshift(client);
    return { payload: contenu, focusClientId: client.id };
  }

  const client = findClient(contenu, saisie.clientId);

  if (saisie.action === "update") {
    if (client.isArchived) throw new Error("CLIENT_ARCHIVED");
    ensureUniqueSiret(contenu, saisie.siret, client.id);
    const updated = parseBusinessClient({
      ...client,
      ...writableValues(saisie, client),
      updatedAt: maintenant,
      updatedByName: auteur.displayName,
    });
    const indice = contenu.clients.findIndex((candidat) => candidat.id === client.id);
    contenu.clients[indice] = updated;
    return { payload: contenu, focusClientId: updated.id };
  }

  if (saisie.action === "updateVat") {
    if (client.isArchived) throw new Error("CLIENT_ARCHIVED");
    const updated = parseBusinessClient({
      ...client,
      defaultVatRatePercent: saisie.defaultVatRatePercent,
      updatedAt: maintenant,
      updatedByName: auteur.displayName,
    });
    const indice = contenu.clients.findIndex((candidat) => candidat.id === client.id);
    contenu.clients[indice] = updated;
    return { payload: contenu, focusClientId: updated.id };
  }

  if (saisie.action === "archive") {
    if (!client.isArchived) {
      client.isArchived = true;
      client.archivedAt = maintenant;
      client.updatedAt = maintenant;
      client.updatedByName = auteur.displayName;
    }
    return { payload: contenu, focusClientId: client.id };
  }

  if (saisie.action === "reactivate") {
    if (client.isArchived) {
      client.isArchived = false;
      client.archivedAt = null;
      client.updatedAt = maintenant;
      client.updatedByName = auteur.displayName;
    }
    return { payload: contenu, focusClientId: client.id };
  }

  throw new Error("CLIENT_MUTATION_UNSUPPORTED");
}
