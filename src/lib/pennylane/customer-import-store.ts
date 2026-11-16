import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { runServerDbMigrations } from "@/lib/server-db/migrations";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import {
  clientDisplayName,
  clientRecordSchema,
  parseClientsPayload,
  type ClientRecord,
} from "@/lib/clients/domain";
import { applyClientsMutation } from "@/lib/clients/mutations";
import { listPennylaneResource, verifyPennylaneCompany } from "./client";
import { readPennylaneStoredConfig } from "./connection";
import { pennylaneEnabled } from "./config";
import {
  mergePennylaneIdentity,
  normalizePennylaneCustomer,
  possibleClientMatches,
} from "./customers";

type StageRow = { external_id: string; payload: unknown };
type ClientRow = { id: string; version: number; record: unknown; sort_order: string };
type SyncRow = { synced_at: Date; item_count: number };

const STAGING_LOCK_ID = "7332170416238558";
const CLIENTS_ORDER_LOCK_ID = "7332170416238504";

export type CustomerCatalogItem = {
  id: string;
  name: string;
  siret: string;
  email: string;
  customerType: string;
  updatedAt: string | null;
  status: "NEW" | "MATCH" | "LINKED" | "INVALID";
  linkedClientId: string | null;
  potentialMatches: Array<{ id: string; name: string; siret: string; archived: boolean }>;
};

export type CustomerCatalog = {
  enabled: boolean;
  synced: boolean;
  lastSyncedAt: string | null;
  count: number;
  truncated: boolean;
  customers: CustomerCatalogItem[];
  existingClients: Array<{
    id: string;
    name: string;
    siret: string;
    pennylaneId: string | null;
    archived: boolean;
  }>;
};

function parseNativeClients(rows: ClientRow[]): ClientRecord[] {
  return parseClientsPayload({
    schemaVersion: 1,
    clients: rows.map((row) => row.record),
  }).clients;
}

export async function readPennylaneCustomerCatalog(
  pool: Pool = getServerDbPool(),
): Promise<CustomerCatalog> {
  await runServerDbMigrations(pool);
  const [staging, status, existing] = await Promise.all([
    pool.query<StageRow>(
      "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource='customers' ORDER BY external_id LIMIT 2001",
    ),
    pool.query<SyncRow>(
      "SELECT synced_at, item_count FROM papot_pennylane_sync_state WHERE resource='customers'",
    ),
    pool.query<ClientRow>(
      "SELECT id, version, record, sort_order::text FROM papot_clients ORDER BY sort_order ASC",
    ),
  ]);
  const clients = parseNativeClients(existing.rows);
  const linked = new Map(clients.filter((c) => c.pennylaneId).map((c) => [c.pennylaneId!, c]));
  const customers = staging.rows.slice(0, 2000).map((row) => {
    try {
      const candidate = normalizePennylaneCustomer(row.payload);
      const alreadyLinked = linked.get(candidate.id);
      const potentialMatches = possibleClientMatches(candidate, clients)
        .filter((client) => !client.pennylaneId || client.pennylaneId === candidate.id)
        .map((client) => ({
          id: client.id,
          name: clientDisplayName(client),
          siret: client.siret,
          archived: client.isArchived,
        }));
      return {
        id: candidate.id,
        name: candidate.name,
        siret: candidate.fields.siret,
        email: candidate.fields.email,
        customerType: candidate.fields.type,
        updatedAt: candidate.updatedAt,
        status: alreadyLinked ? "LINKED" : potentialMatches.length > 0 ? "MATCH" : "NEW",
        linkedClientId: alreadyLinked?.id ?? null,
        potentialMatches,
      } satisfies CustomerCatalogItem;
    } catch {
      return {
        id: row.external_id,
        name: "Fiche Pennylane à corriger",
        siret: "",
        email: "",
        customerType: "",
        updatedAt: null,
        status: "INVALID",
        linkedClientId: null,
        potentialMatches: [],
      } satisfies CustomerCatalogItem;
    }
  });
  return {
    enabled: pennylaneEnabled(),
    synced: status.rows.length > 0,
    lastSyncedAt: status.rows[0]?.synced_at.toISOString() ?? null,
    count: status.rows[0]?.item_count ?? 0,
    truncated: staging.rows.length > 2000,
    customers,
    existingClients: clients.map((client) => ({
      id: client.id,
      name: clientDisplayName(client),
      siret: client.siret,
      pennylaneId: client.pennylaneId ?? null,
      archived: client.isArchived,
    })),
  };
}

/** Refresh the isolated customer snapshot without changing any native client. */
export async function refreshPennylaneCustomerCatalog(
  pool: Pool = getServerDbPool(),
): Promise<number> {
  if (!pennylaneEnabled()) throw new Error("PENNYLANE_DISABLED");
  await runServerDbMigrations(pool);
  const config = await readPennylaneStoredConfig(pool);
  const companyName = await verifyPennylaneCompany(config);
  const customers = await listPennylaneResource("customers", config);
  await withServerDbTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [STAGING_LOCK_ID]);
    await client.query("DELETE FROM papot_pennylane_staging WHERE resource='customers'");
    if (customers.length > 0) {
      await client.query(
        "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) SELECT 'customers', r.id, r.payload, NOW() FROM jsonb_to_recordset($1::jsonb) AS r(id text, payload jsonb)",
        [
          JSON.stringify(
            customers.map((row) => ({
              id: String(row.id),
              payload: row,
            })),
          ),
        ],
      );
    }
    await client.query(
      "INSERT INTO papot_pennylane_sync_state (resource, company_name, synced_at, item_count) VALUES ('customers', $1, NOW(), $2) ON CONFLICT (resource) DO UPDATE SET company_name=EXCLUDED.company_name, synced_at=NOW(), item_count=EXCLUDED.item_count",
      [companyName, customers.length],
    );
  }, pool);
  return customers.length;
}

export async function importPennylaneCustomer(
  action: "IMPORT" | "LINK",
  customerId: string,
  chosenClientId: string | null,
  actor: string,
  pool: Pool = getServerDbPool(),
): Promise<{ clientId: string; action: "CREATED" | "LINKED" | "UPDATED" }> {
  if (!pennylaneEnabled()) throw new Error("PENNYLANE_DISABLED");
  if (!/^\d{1,20}$/.test(customerId)) throw new Error("PENNYLANE_CUSTOMER_ID_INVALID");
  await runServerDbMigrations(pool);
  return withServerDbTransaction(async (client) => {
    // Stage refresh and client creation cannot race with a manual link.
    await client.query("SELECT pg_advisory_xact_lock($1)", [STAGING_LOCK_ID]);
    await client.query("SELECT pg_advisory_xact_lock($1)", [CLIENTS_ORDER_LOCK_ID]);
    const customerRows = await client.query<StageRow>(
      "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource='customers' AND external_id=$1",
      [customerId],
    );
    if (!customerRows.rows[0]) throw new Error("PENNYLANE_CUSTOMER_NOT_IMPORTED");
    const customer = normalizePennylaneCustomer(customerRows.rows[0].payload);
    const raw = await client.query<ClientRow>(
      "SELECT id, version, record, sort_order::text FROM papot_clients ORDER BY sort_order ASC FOR UPDATE",
    );
    const native = parseNativeClients(raw.rows);
    const alreadyLinked = native.find((c) => c.pennylaneId === customer.id);
    if (alreadyLinked && chosenClientId && chosenClientId !== alreadyLinked.id) {
      throw new Error("PENNYLANE_CLIENT_LINK_CONFLICT");
    }
    if (action === "LINK" && !chosenClientId) throw new Error("PENNYLANE_CLIENT_LINK_REQUIRED");
    const target =
      alreadyLinked ?? (chosenClientId ? native.find((c) => c.id === chosenClientId) : undefined);
    if (action === "LINK" && !target) throw new Error("CLIENT_NOT_FOUND");
    const candidates = possibleClientMatches(customer, native).filter(
      (c) => !target || c.id !== target.id,
    );
    if (candidates.length > 0) throw new Error("PENNYLANE_CLIENT_LINK_REQUIRED");
    const now = new Date();
    if (target) {
      if (target.pennylaneId && target.pennylaneId !== customer.id) {
        throw new Error("PENNYLANE_CLIENT_LINK_CONFLICT");
      }
      const updated = clientRecordSchema.parse(
        mergePennylaneIdentity(target, customer, actor, now),
      );
      const previous = raw.rows.find((c) => c.id === target.id)!;
      const result = await client.query(
        "UPDATE papot_clients SET version=version+1, siret=$2, record=$3::jsonb, updated_at=$4 WHERE id=$1 AND version=$5",
        [
          target.id,
          updated.siret || null,
          JSON.stringify(updated),
          updated.updatedAt,
          previous.version,
        ],
      );
      if (result.rowCount !== 1) throw new Error("CLIENTS_VERSION_CONFLICT");
      return { clientId: target.id, action: alreadyLinked ? "UPDATED" : "LINKED" };
    }
    if (action === "LINK") throw new Error("CLIENT_NOT_FOUND");
    const id = randomUUID();
    const mutation = applyClientsMutation(
      { schemaVersion: 1, clients: native },
      {
        action: "create",
        clientId: id,
        ...customer.fields,
        contacts: [],
        notes: "",
      },
      { userId: "pennylane", displayName: actor },
      now,
    );
    const created = clientRecordSchema.parse({
      ...mutation.payload.clients.find((c) => c.id === id)!,
      pennylaneId: customer.id,
    });
    const minimum = raw.rows.reduce<bigint | null>((min, row) => {
      const n = BigInt(row.sort_order);
      return min === null || n < min ? n : min;
    }, null);
    const sortOrder = minimum === null ? -1n : minimum - 1n;
    await client.query(
      "INSERT INTO papot_clients (id, version, siret, sort_order, record, created_at, updated_at) VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6)",
      [
        id,
        created.siret || null,
        sortOrder.toString(),
        JSON.stringify(created),
        created.createdAt,
        created.updatedAt,
      ],
    );
    return { clientId: id, action: "CREATED" };
  }, pool);
}
