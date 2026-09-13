import "server-only";

import { randomUUID } from "node:crypto";
import {
  clientConfirmationMissingFields,
  clientDisplayName,
  parseClientsPayload,
  type ClientRecord,
} from "@/lib/clients/domain";
import { applyClientsMutation } from "@/lib/clients/mutations";
import type { CommercialClient, CommercialPayload } from "@/lib/commercial/domain";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";

const CLIENTS_RESOURCE = { resource_type: "CLIENTS" as const, resource_id: "global" };
const CLIENTS_LOCK_TTL_MS = 30_000;

type Desktop = ReturnType<typeof createDesktopSharedResourceRuntime>;
type Owner = { userId: string; deviceId: string; displayName: string };
type Actor = { userId: string; displayName: string };

export type ResolvedCommercialClient = {
  id: string;
  displayName: string;
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("fr-FR");
}

function activeClient(
  payload: ReturnType<typeof parseClientsPayload>,
  clientId: string,
): ClientRecord {
  const client = payload.clients.find((candidate) => candidate.id === clientId);
  if (!client || client.isArchived) throw new Error("COMMERCIAL_CLIENT_NOT_FOUND");
  return client;
}

export async function readCanonicalClients(desktop: Desktop) {
  const resource = await desktop.states.get(CLIENTS_RESOURCE);
  return parseClientsPayload(resource?.payload);
}

export async function listCanonicalCommercialClients(
  desktop: Desktop,
): Promise<CommercialClient[]> {
  const payload = await readCanonicalClients(desktop);
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
  desktop: Desktop,
  owner: Owner,
  actor: Actor,
  displayName: string,
): Promise<ResolvedCommercialClient> {
  const leaseId = randomUUID();
  let ownsLock = false;
  try {
    const [lock, openedInitial] = await Promise.all([
      desktop.locks.acquire({
        resource: CLIENTS_RESOURCE,
        leaseId,
        owner,
        baseVersion: 0,
        ttlMs: CLIENTS_LOCK_TTL_MS,
        reclaimOwnAfterMs: 0,
      }),
      desktop.states.openForUpdate(CLIENTS_RESOURCE),
    ]);
    if (lock.status === "locked") throw new Error("CLIENTS_LOCKED");
    ownsLock = true;

    const clientId = randomUUID();
    const input = {
      action: "create" as const,
      clientId,
      type: "AUTRE" as const,
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
    };

    let opened = openedInitial;
    let mutation = applyClientsMutation(
      parseClientsPayload(opened.resource?.payload),
      input,
      actor,
    );
    let saved = await desktop.states.saveOpened({
      resource: CLIENTS_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      opened = await desktop.states.openForUpdate(CLIENTS_RESOURCE);
      mutation = applyClientsMutation(parseClientsPayload(opened.resource?.payload), input, actor);
      saved = await desktop.states.saveOpened({
        resource: CLIENTS_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }
    if (saved.status === "conflict") throw new Error("CLIENTS_VERSION_CONFLICT");

    const created = activeClient(parseClientsPayload(saved.resource.payload), clientId);
    return { id: created.id, displayName: clientDisplayName(created) };
  } finally {
    if (ownsLock) {
      void desktop.locks
        .release({ resource: CLIENTS_RESOURCE, leaseId, owner })
        .catch(() => undefined);
    }
  }
}

export async function resolveCommercialClient(params: {
  desktop: Desktop;
  owner: Owner;
  actor: Actor;
  existingClientId?: string;
  newClientName?: string;
  currentClientId?: string | null;
}): Promise<ResolvedCommercialClient> {
  const existingClientId = params.existingClientId?.trim();
  if (existingClientId) {
    const payload = await readCanonicalClients(params.desktop);
    const client = activeClient(payload, existingClientId);
    return { id: client.id, displayName: clientDisplayName(client) };
  }

  const newClientName = params.newClientName?.trim() ?? "";
  if (!newClientName) throw new Error("COMMERCIAL_CLIENT_REQUIRED");

  if (params.currentClientId) {
    const payload = await readCanonicalClients(params.desktop);
    const current = payload.clients.find(
      (candidate) => candidate.id === params.currentClientId && !candidate.isArchived,
    );
    if (current && normalizeName(clientDisplayName(current)) === normalizeName(newClientName)) {
      return { id: current.id, displayName: clientDisplayName(current) };
    }
  }

  return createProvisionalClient(params.desktop, params.owner, params.actor, newClientName);
}

export async function assertCommercialClientReadyForConfirmation(
  desktop: Desktop,
  clientId: string | null | undefined,
): Promise<void> {
  if (!clientId) throw new Error("COMMERCIAL_CLIENT_REQUIRED");
  const payload = await readCanonicalClients(desktop);
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
