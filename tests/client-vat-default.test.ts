import { describe, expect, it } from "vitest";
import { parseClientsPayload } from "../src/lib/clients/domain";
import { applyClientsMutation } from "../src/lib/clients/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

const legacyClient = {
  id: "22222222-2222-4222-8222-222222222222",
  type: "ENTREPRISE",
  companyName: "PAPOT Test",
  firstName: "",
  lastName: "",
  addressLine1: "1 rue du Test",
  addressLine2: "",
  postalCode: "42300",
  city: "Roanne",
  phone: "",
  email: "",
  siret: "12345678901234",
  paymentTerms: "45 jours fin de mois",
  notes: "",
  contacts: [],
  isArchived: false,
  archivedAt: null,
  createdAt: "2026-09-17T06:00:00.000Z",
  createdByName: "Lucien",
  updatedAt: "2026-09-17T06:00:00.000Z",
  updatedByName: "Lucien",
};

describe("client default VAT", () => {
  it("charge un ancien client sans TVA avec le taux standard de migration", () => {
    const payload = parseClientsPayload({ schemaVersion: 1, clients: [legacyClient] });
    expect(payload.clients[0].defaultVatRatePercent).toBe(20);
  });

  it("modifie uniquement le taux de TVA par défaut d'une fiche active", () => {
    const payload = parseClientsPayload({ schemaVersion: 1, clients: [legacyClient] });
    const result = applyClientsMutation(
      payload,
      {
        action: "updateVat",
        clientId: legacyClient.id,
        defaultVatRatePercent: 10,
      },
      actor,
      new Date("2026-09-17T07:00:00.000Z"),
    );

    expect(result.payload.clients[0].defaultVatRatePercent).toBe(10);
    expect(result.payload.clients[0].companyName).toBe("PAPOT Test");
    expect(result.payload.clients[0].paymentTerms).toBe("45 jours fin de mois");
    expect(result.payload.clients[0].updatedAt).toBe("2026-09-17T07:00:00.000Z");
  });

  it("conserve le taux existant quand une autre donnée de la fiche est modifiée", () => {
    const payload = parseClientsPayload({ schemaVersion: 1, clients: [legacyClient] });
    const withVat = applyClientsMutation(
      payload,
      {
        action: "updateVat",
        clientId: legacyClient.id,
        defaultVatRatePercent: 10,
      },
      actor,
    );
    const client = withVat.payload.clients[0];

    const updated = applyClientsMutation(
      withVat.payload,
      {
        action: "update",
        clientId: client.id,
        type: client.type,
        companyName: client.companyName,
        firstName: client.firstName,
        lastName: client.lastName,
        addressLine1: "2 rue du Test",
        addressLine2: client.addressLine2,
        postalCode: client.postalCode,
        city: client.city,
        phone: client.phone,
        email: client.email,
        siret: client.siret,
        paymentTerms: client.paymentTerms,
        notes: client.notes,
        contacts: client.contacts,
      },
      actor,
    );

    expect(updated.payload.clients[0].addressLine1).toBe("2 rue du Test");
    expect(updated.payload.clients[0].defaultVatRatePercent).toBe(10);
  });

  it("refuse un taux hors plage", () => {
    const payload = parseClientsPayload({ schemaVersion: 1, clients: [legacyClient] });
    expect(() =>
      applyClientsMutation(
        payload,
        {
          action: "updateVat",
          clientId: legacyClient.id,
          defaultVatRatePercent: 120,
        },
        actor,
      ),
    ).toThrow();
  });
});
