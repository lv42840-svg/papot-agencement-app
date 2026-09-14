import "server-only";

import { randomUUID } from "node:crypto";
import {
  clientConfirmationMissingFields,
  clientDisplayName,
  type ClientRecord,
} from "@/lib/clients/domain";
import type { ClientsRepository } from "@/lib/clients/repository";
import type { CommercialClient, CommercialPayload } from "@/lib/commercial/domain";

export type ResolvedCommercialClient = {
  id: string;
  displayName: string;
};

type Actor = { userId: string; displayName: string };

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("fr-FR");
}

function activeClient(
  payload: Awaited<ReturnType<ClientsRepository["load"]>>,
  clientId: string,
): ClientRecord {
  const client = payload.clients.find((candidate) => candidate.id === clientId);
  if (!client || client.isArchived) throw new Error("COMMERCIAL_CLIENT_NOT_FOUND");
  return client;
}

export async function readCanonicalClients(clients: ClientsRepository) {
  return clients.load();
}

export async function listCanonicalCommercialClients(
  clients: ClientsRepository,
): Promise<CommercialClient[]> {
  const payload = await readCanonicalClients(clients);
  return payload.clients
    .filter((client) => !client.isArchived)
    .map((client) => ({
      id: client.id,
      type: client.type === "PARTICULIER" ? ("INDIVIDUAL" as const) : ("COMPANY" as const),
      displayName: clientDisplayName(client),
      email: client.email || null,
      phone: client.phone || null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr-FR", { sensitivity: "base" }));
}

export function hydrateCommercialPayloadWithCanonicalClients(
  payload: CommercialPayload,
  clients: CommercialClient[],
): CommercialPayload {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  return {
    ...payload,
    clients,
    cases: payload.cases.map((item) => {
      if (!item.clientId) return item;
      const client = clientsById.get(item.clientId);
      return client ? { ...item, clientName: client.displayName } : item;
    }),
  };
}

async function createProvisionalClient(
  clients: ClientsRepository,
  actor: Actor,
  displayName: string,
): Promise<ResolvedCommercialClient> {
  const clientId = randomUUID();
  const mutation = await clients.mutate(
    {
      action: "create",
      clientId,
      type: "AUTRE",
      companyName: displayName.trim(),
      firstName: "",
      lastName: "",
      addressLine1: "",
      addressLine2: "",
      postalCode: "",
      city: "",
      phone: "",
      email: "",
      siret: "",
      paymentTerms: "",
      notes: "",
      contacts: [],
    },
    actor,
  );

  const created = activeClient(mutation.payload, clientId);
  return { id: created.id, displayName: clientDisplayName(created) };
}

export async function resolveCommercialClient(params: {
  clients: ClientsRepository;
  actor: Actor;
  existingClientId?: string;
  newClientName?: string;
  currentClientId?: string | null;
}): Promise<ResolvedCommercialClient> {
  const existingClientId = params.existingClientId?.trim();
  if (existingClientId) {
    const payload = await readCanonicalClients(params.clients);
    const client = activeClient(payload, existingClientId);
    return { id: client.id, displayName: clientDisplayName(client) };
  }

  const newClientName = params.newClientName?.trim() ?? "";
  if (!newClientName) throw new Error("COMMERCIAL_CLIENT_REQUIRED");

  if (params.currentClientId) {
    const payload = await readCanonicalClients(params.clients);
    const current = payload.clients.find(
      (candidate) => candidate.id === params.currentClientId && !candidate.isArchived,
    );
    if (current && normalizeName(clientDisplayName(current)) === normalizeName(newClientName)) {
      return { id: current.id, displayName: clientDisplayName(current) };
    }
  }

  return createProvisionalClient(params.clients, params.actor, newClientName);
}

export async function assertCommercialClientReadyForConfirmation(
  clients: ClientsRepository,
  clientId: string | null | undefined,
): Promise<void> {
  if (!clientId) throw new Error("COMMERCIAL_CLIENT_REQUIRED");
  const payload = await readCanonicalClients(clients);
  const client = activeClient(payload, clientId);
  const missing = clientConfirmationMissingFields(client);
  if (missing.length > 0) {
    console.warn("[PAPOT][Commercial] client incomplete for confirmation", {
      clientId,
      missing,
    });
    throw new Error("COMMERCIAL_CLIENT_INCOMPLETE");
  }
}
