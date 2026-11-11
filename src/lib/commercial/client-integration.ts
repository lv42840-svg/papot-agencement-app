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

function normalizeName(valeur: string): string {
  return valeur.trim().toLocaleLowerCase("fr-FR");
}

function activeClient(
  contenu: Awaited<ReturnType<ClientsRepository["load"]>>,
  idClient: string,
): ClientRecord {
  const client = contenu.clients.find((candidat) => candidat.id === idClient);
  if (!client || client.isArchived) throw new Error("COMMERCIAL_CLIENT_NOT_FOUND");
  return client;
}

export async function readCanonicalClients(clients: ClientsRepository) {
  return clients.load();
}

export async function listCanonicalCommercialClients(
  clients: ClientsRepository,
): Promise<CommercialClient[]> {
  const contenu = await readCanonicalClients(clients);
  return contenu.clients
    .filter((client) => !client.isArchived)
    .map((client) => ({
      id: client.id,
      type: client.type === "PARTICULIER" ? ("INDIVIDUAL" as const) : ("COMPANY" as const),
      displayName: clientDisplayName(client),
      email: client.email || null,
      phone: client.phone || null,
      addressLine1: client.addressLine1 || null,
      addressLine2: client.addressLine2 || null,
      postalCode: client.postalCode || null,
      city: client.city || null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr-FR", { sensitivity: "base" }));
}

export function hydrateCommercialPayloadWithCanonicalClients(
  contenu: CommercialPayload,
  clients: CommercialClient[],
): CommercialPayload {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  return {
    ...contenu,
    clients,
    cases: contenu.cases.map((element) => {
      if (!element.clientId) return element;
      const client = clientsById.get(element.clientId);
      return client ? { ...element, clientName: client.displayName } : element;
    }),
  };
}

async function createProvisionalClient(
  clients: ClientsRepository,
  auteur: Actor,
  displayName: string,
): Promise<ResolvedCommercialClient> {
  const idClient = randomUUID();
  const mutation = await clients.mutate(
    {
      action: "create",
      clientId: idClient,
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
    auteur,
  );

  const created = activeClient(mutation.payload, idClient);
  return { id: created.id, displayName: clientDisplayName(created) };
}

export async function resolveCommercialClient(parametres: {
  clients: ClientsRepository;
  actor: Actor;
  existingClientId?: string;
  newClientName?: string;
  currentClientId?: string | null;
}): Promise<ResolvedCommercialClient> {
  const existingClientId = parametres.existingClientId?.trim();
  if (existingClientId) {
    const contenu = await readCanonicalClients(parametres.clients);
    const client = activeClient(contenu, existingClientId);
    return { id: client.id, displayName: clientDisplayName(client) };
  }

  const newClientName = parametres.newClientName?.trim() ?? "";
  if (!newClientName) throw new Error("COMMERCIAL_CLIENT_REQUIRED");

  if (parametres.currentClientId) {
    const contenu = await readCanonicalClients(parametres.clients);
    const courant = contenu.clients.find(
      (candidat) => candidat.id === parametres.currentClientId && !candidat.isArchived,
    );
    if (courant && normalizeName(clientDisplayName(courant)) === normalizeName(newClientName)) {
      return { id: courant.id, displayName: clientDisplayName(courant) };
    }
  }

  return createProvisionalClient(parametres.clients, parametres.actor, newClientName);
}

export async function assertCommercialClientReadyForConfirmation(
  clients: ClientsRepository,
  idClient: string | null | undefined,
): Promise<void> {
  if (!idClient) throw new Error("COMMERCIAL_CLIENT_REQUIRED");
  const contenu = await readCanonicalClients(clients);
  const client = activeClient(contenu, idClient);
  const missing = clientConfirmationMissingFields(client);
  if (missing.length > 0) {
    console.warn("[PAPOT][Commercial] client incomplete for confirmation", {
      clientId: idClient,
      missing,
    });
    throw new Error("COMMERCIAL_CLIENT_INCOMPLETE");
  }
}
