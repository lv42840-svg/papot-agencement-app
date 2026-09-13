import { describe, expect, it } from "vitest";
import {
  clientConfirmationMissingFields,
  createInitialClientsPayload,
  isClientReadyForConfirmation,
} from "../src/lib/clients/domain";
import { applyClientsMutation } from "../src/lib/clients/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

const baseFields = {
  type: "ENTREPRISE" as const,
  companyName: "Dupont Agencement",
  firstName: "",
  lastName: "",
  addressLine1: "12 rue des Ateliers",
  addressLine2: "",
  postalCode: "42300",
  city: "Roanne",
  phone: "04 77 00 00 00",
  email: "contact@dupont.test",
  siret: "12345678901234",
  paymentTerms: "45 jours fin de mois",
  notes: "Client test",
  contacts: [],
};

describe("clients domain", () => {
  it("creates a company and keeps its payment terms", () => {
    const result = applyClientsMutation(
      createInitialClientsPayload(),
      { action: "create", ...baseFields },
      actor,
      new Date("2026-09-13T17:00:00.000Z"),
    );

    expect(result.payload.clients).toHaveLength(1);
    expect(result.payload.clients[0].companyName).toBe("Dupont Agencement");
    expect(result.payload.clients[0].paymentTerms).toBe("45 jours fin de mois");
    expect(result.payload.clients[0].isArchived).toBe(false);
    expect(isClientReadyForConfirmation(result.payload.clients[0])).toBe(true);
  });

  it("allows a provisional client while the quote is still being prepared", () => {
    const result = applyClientsMutation(
      createInitialClientsPayload(),
      {
        action: "create",
        ...baseFields,
        addressLine1: "",
        postalCode: "",
        city: "",
        siret: "",
        paymentTerms: "",
      },
      actor,
    );

    const client = result.payload.clients[0];
    expect(client.companyName).toBe("Dupont Agencement");
    expect(isClientReadyForConfirmation(client)).toBe(false);
    expect(clientConfirmationMissingFields(client)).toEqual([
      "addressLine1",
      "postalCode",
      "city",
      "siret",
      "paymentTerms",
    ]);
  });

  it("does not require SIRET from a private individual before confirmation", () => {
    const result = applyClientsMutation(
      createInitialClientsPayload(),
      {
        action: "create",
        ...baseFields,
        type: "PARTICULIER",
        companyName: "",
        firstName: "Marie",
        lastName: "Durand",
        siret: "",
      },
      actor,
    );

    expect(clientConfirmationMissingFields(result.payload.clients[0])).toEqual([]);
  });

  it("updates contacts and payment terms without changing the client id", () => {
    const created = applyClientsMutation(
      createInitialClientsPayload(),
      { action: "create", ...baseFields },
      actor,
    );
    const clientId = created.payload.clients[0].id;

    const updated = applyClientsMutation(
      created.payload,
      {
        action: "update",
        clientId,
        ...baseFields,
        paymentTerms: "30 jours date de facture",
        contacts: [
          {
            firstName: "Nadia",
            lastName: "Martin",
            role: "Conductrice de travaux",
            phone: "06 00 00 00 00",
            email: "nadia@dupont.test",
            isPrimary: true,
          },
        ],
      },
      actor,
    );

    expect(updated.payload.clients[0].id).toBe(clientId);
    expect(updated.payload.clients[0].paymentTerms).toBe("30 jours date de facture");
    expect(updated.payload.clients[0].contacts).toHaveLength(1);
    expect(updated.payload.clients[0].contacts[0].isPrimary).toBe(true);
  });

  it("rejects a duplicate SIRET", () => {
    const created = applyClientsMutation(
      createInitialClientsPayload(),
      { action: "create", ...baseFields },
      actor,
    );

    expect(() =>
      applyClientsMutation(
        created.payload,
        {
          action: "create",
          ...baseFields,
          companyName: "Autre société",
        },
        actor,
      ),
    ).toThrow("CLIENT_SIRET_EXISTS");
  });

  it("archives and reactivates without deleting the client", () => {
    const created = applyClientsMutation(
      createInitialClientsPayload(),
      { action: "create", ...baseFields },
      actor,
    );
    const clientId = created.payload.clients[0].id;

    const archived = applyClientsMutation(
      created.payload,
      { action: "archive", clientId },
      actor,
      new Date("2026-09-13T18:00:00.000Z"),
    );
    expect(archived.payload.clients[0].isArchived).toBe(true);
    expect(archived.payload.clients[0].archivedAt).toBe("2026-09-13T18:00:00.000Z");

    const reactivated = applyClientsMutation(
      archived.payload,
      { action: "reactivate", clientId },
      actor,
    );
    expect(reactivated.payload.clients).toHaveLength(1);
    expect(reactivated.payload.clients[0].isArchived).toBe(false);
    expect(reactivated.payload.clients[0].archivedAt).toBeNull();
  });
});
