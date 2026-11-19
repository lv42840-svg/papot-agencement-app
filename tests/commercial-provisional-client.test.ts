import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInitialClientsPayload } from "../src/lib/clients/domain";
import { applyClientsMutation } from "../src/lib/clients/mutations";
import { commercialMutationSchema } from "../src/lib/commercial/mutations";
import { resolveCommercialClient } from "../src/lib/commercial/client-integration";
import { isAllowedCommercialProvisionalCreate } from "../src/lib/clients/provisional-policy";
import type { ClientsRepository, ClientsMutationOptions } from "../src/lib/clients/repository";

const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Test" };

function setup() {
  let payload = createInitialClientsPayload();
  const optionsSeen: Array<ClientsMutationOptions | undefined> = [];
  let created = 0;
  const clients: ClientsRepository = {
    async load() {
      return payload;
    },
    async mutate(input, user, options) {
      expect(isAllowedCommercialProvisionalCreate(input, options)).toBe(true);
      created += 1;
      optionsSeen.push(options);
      const result = applyClientsMutation(payload, input, user);
      payload = result.payload;
      return result;
    },
  };
  return { clients, optionsSeen, get payload() { return payload; }, get created() { return created; } };
}

describe("New commercial affair and customer", () => {
  it("creates an unlinked provisional customer despite Pennylane's normal create restriction", async () => {
    const state = setup();
    const selected = await resolveCommercialClient({
      clients: state.clients, actor, newClientName: "Client sans fiche",
    });
    expect(state.created).toBe(1);
    expect(state.optionsSeen).toEqual([{ source: "commercialProvisional" }]);
    expect(state.payload.clients[0].id).toBe(selected.id);
    expect(state.payload.clients[0].pennylaneId).toBeUndefined();
    expect(state.payload.clients[0].siret).toBe("");
    expect(state.payload.clients[0].type).toBe("AUTRE");
  });

  it("stores an explicitly selected official SIRET and headquarters address", async () => {
    const state = setup();
    await resolveCommercialClient({
      clients: state.clients,
      actor,
      newClientName: "ATELIER EXEMPLE",
      newClientSiret: "12345678901234",
      newClientAddressLine1: "5 RUE DES BOIS",
      newClientPostalCode: "42190",
      newClientCity: "CHARLIEU",
    });
    expect(state.payload.clients[0]).toMatchObject({
      companyName: "ATELIER EXEMPLE",
      type: "ENTREPRISE",
      siret: "12345678901234",
      addressLine1: "5 RUE DES BOIS",
      postalCode: "42190",
      city: "CHARLIEU",
    });
  });

  it("reuses an existing customer without creating a duplicate", async () => {
    const state = setup();
    const original = await resolveCommercialClient({
      clients: state.clients, actor, newClientName: "Existant",
    });
    const selected = await resolveCommercialClient({
      clients: state.clients,
      actor,
      existingClientId: original.id,
      newClientName: "ignored",
    });
    expect(selected.id).toBe(original.id);
    expect(state.created).toBe(1);
  });

  it("rejects untrusted clients API creation without the internal provisional option", () => {
    const input = {
      action: "create" as const,
      clientId: "11111111-1111-4111-8111-111111111111",
      type: "ENTREPRISE" as const,
      companyName: "ABC",
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
    expect(isAllowedCommercialProvisionalCreate(input)).toBe(false);
    expect(isAllowedCommercialProvisionalCreate(input, { source: "commercialProvisional" })).toBe(true);
    expect(
      isAllowedCommercialProvisionalCreate(
        { ...input, paymentTerms: "60 jours" },
        { source: "commercialProvisional" },
      ),
    ).toBe(false);
  });

  it("validates the optional SIRET before starting creation", () => {
    const valid = commercialMutationSchema.parse({
      action: "create",
      name: "Test",
      clientName: "Client",
      reviewDate: "2026-11-20",
      newClientSiret: "12345678901234",
    });
    expect(valid.action).toBe("create");
    expect(() =>
      commercialMutationSchema.parse({
        action: "create",
        name: "Test",
        clientName: "Client",
        reviewDate: "2026-11-20",
        newClientSiret: "123",
      }),
    ).toThrow();
  });
});
