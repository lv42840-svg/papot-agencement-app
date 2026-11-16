import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyClientsMutation } from "../src/lib/clients/mutations";
import { getServerDbPool, closeServerDbPool } from "../src/lib/server-db/pool";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import {
  importPennylaneCustomer,
  readPennylaneCustomerCatalog,
} from "../src/lib/pennylane/customer-import-store";
import { createPostgresClientsRepository } from "../src/lib/clients/postgres-repository";

const describeIfPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;
const providerId = "918000001001";
const providerIdNew = "918000001002";
const siret = "85643001900028";
const prior = process.env.PAPOT_PENNYLANE_ENABLED;
const provider = {
  id: Number(providerId),
  customer_type: "company",
  name: "Entreprise test Pennylane",
  reg_no: "856430019",
  electronic_billing_address: "856430019_00028",
  vat_number: "FR99856430019",
  payment_conditions: "30_days",
  emails: ["contact@example.org"],
  billing_address: { address: "4 avenue de la Gare", postal_code: "42190", city: "Charlieu" },
};

describeIfPostgres("import clients Pennylane et préservation du référentiel existant", () => {
  let pool: Pool;
  let originalId: string;

  beforeAll(async () => {
    process.env.PAPOT_PENNYLANE_ENABLED = "true";
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
    originalId = randomUUID();
    const created = applyClientsMutation(
      { schemaVersion: 1, clients: [] },
      {
        action: "create", clientId: originalId, type: "ENTREPRISE",
        companyName: "Entreprise test Pennylane", firstName: "", lastName: "",
        addressLine1: "Ancienne adresse", addressLine2: "",
        postalCode: "42190", city: "Charlieu",
        phone: "", email: "", siret, vatNumber: "",
        paymentTerms: "Comptant", notes: "Notes chantier à préserver",
        contacts: [], defaultVatRatePercent: 10,
      },
      { userId: randomUUID(), displayName: "Nadia" },
    ).payload.clients[0];
    await pool.query(
      "INSERT INTO papot_clients (id,version,siret,sort_order,record,created_at,updated_at) VALUES ($1,1,$2,$3,$4::jsonb,$5,$6)",
      [created.id, siret, "-999999", JSON.stringify(created), created.createdAt, created.updatedAt],
    );
    await pool.query(
      "INSERT INTO papot_pennylane_staging (resource,external_id,payload,synced_at) VALUES ('customers',$1,$2::jsonb,NOW())",
      [providerId, JSON.stringify(provider)],
    );
    await pool.query(
      "INSERT INTO papot_pennylane_sync_state (resource, company_name, synced_at,item_count) VALUES ('customers','PAPOT LIBERAL',NOW(),1) ON CONFLICT (resource) DO UPDATE SET synced_at=NOW(), item_count=1",
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM papot_clients WHERE id=$1 OR record->>'pennylaneId' IN ($2,$3)", [originalId, providerId, providerIdNew]);
      await pool.query("DELETE FROM papot_pennylane_staging WHERE resource='customers' AND external_id IN ($1,$2)", [providerId, providerIdNew]);
      await pool.query("DELETE FROM papot_pennylane_sync_state WHERE resource='customers'");
      await closeServerDbPool();
    }
    if (prior === undefined) delete process.env.PAPOT_PENNYLANE_ENABLED;
    else process.env.PAPOT_PENNYLANE_ENABLED = prior;
  });

  it("signale le rapprochement obligatoire et interdit un second UUID", async () => {
    const catalog = await readPennylaneCustomerCatalog(pool);
    const item = catalog.customers.find(c => c.id === providerId)!;
    expect(item.status).toBe("MATCH");
    expect(item.potentialMatches[0]?.id).toBe(originalId);
    await expect(importPennylaneCustomer("IMPORT", providerId, null, "Nadia", pool))
      .rejects.toThrow("PENNYLANE_CLIENT_LINK_REQUIRED");
  });

  it("rattache la fiche existante sans perdre les affaires liées à son UUID", async () => {
    const result = await importPennylaneCustomer("LINK", providerId, originalId, "Nadia", pool);
    expect(result).toEqual({ clientId: originalId, action: "LINKED" });
    const rows = await pool.query<{ record: {
      id: string; pennylaneId: string; notes: string; defaultVatRatePercent: number;
      addressLine1: string; contacts: unknown[];
    } }>("SELECT record FROM papot_clients WHERE id=$1", [originalId]);
    expect(rows.rows[0].record.id).toBe(originalId);
    expect(rows.rows[0].record.pennylaneId).toBe(providerId);
    expect(rows.rows[0].record.notes).toBe("Notes chantier à préserver");
    expect(rows.rows[0].record.defaultVatRatePercent).toBe(10);
    expect(rows.rows[0].record.addressLine1).toBe("4 avenue de la Gare");
    expect(rows.rows[0].record.contacts).toEqual([]);
  });

  it("actualise la fiche liée, sans créer une deuxième fiche", async () => {
    await pool.query(
      "UPDATE papot_pennylane_staging SET payload=jsonb_set(payload,'{billing_address,address}','\"9 avenue de la Gare\"'::jsonb) WHERE resource='customers' AND external_id=$1",
      [providerId],
    );
    const result = await importPennylaneCustomer("IMPORT", providerId, null, "Nadia", pool);
    expect(result).toEqual({ clientId: originalId, action: "UPDATED" });
    const rows = await pool.query<{ record: { addressLine1: string } }>(
      "SELECT record FROM papot_clients WHERE id=$1", [originalId],
    );
    expect(rows.rows[0].record.addressLine1).toBe("9 avenue de la Gare");
  });

  it("interdit toute création directe dans PAPOT lorsque Pennylane est la référence", async () => {
    const repository = createPostgresClientsRepository(pool);
    await expect(repository.mutate({
      action: "create", type: "ENTREPRISE", companyName: "Client hors Pennylane",
      firstName: "", lastName: "", addressLine1: "", addressLine2: "",
      postalCode: "", city: "", phone: "", email: "", siret: "",
      vatNumber: "", paymentTerms: "", notes: "", contacts: [],
    }, { userId: randomUUID(), displayName: "Nadia" }))
      .rejects.toThrow("CLIENT_CREATE_IN_PENNYLANE");
  });

  it("importe un vrai nouveau client une seule fois, même après plusieurs clics", async () => {
    await pool.query(
      "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) VALUES ('customers',$1,$2::jsonb,NOW())",
      [providerIdNew, JSON.stringify({
        ...provider, id: Number(providerIdNew), name: "Deuxième client de test",
        reg_no: "987654321", electronic_billing_address: "987654321_00042",
      })],
    );
    const first = await importPennylaneCustomer("IMPORT", providerIdNew, null, "Nadia", pool);
    const second = await importPennylaneCustomer("IMPORT", providerIdNew, null, "Nadia", pool);
    expect(first.action).toBe("CREATED");
    expect(second).toEqual({ clientId: first.clientId, action: "UPDATED" });
    const rows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM papot_clients WHERE record->>'pennylaneId'=$1",
      [providerIdNew],
    );
    expect(rows.rows[0].count).toBe("1");
  });
});
