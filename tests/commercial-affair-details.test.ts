import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

describe("commercial affair details", () => {
  it("keeps legacy affair contact data when the simplified form updates the affair", () => {
    const created = applyCommercialMutation(
      createInitialCommercialPayload(),
      {
        action: "create",
        name: "Cuisine Dupont",
        clientName: "Dupont",
        siteLabel: "Roanne",
        reviewDate: "2026-09-20",
        description: "",
        nextAction: "",
      },
      actor,
    ).payload;
    const affair = created.cases[0];

    const withLegacyContact = applyCommercialMutation(
      created,
      {
        action: "updateDetails",
        caseId: affair.id,
        name: affair.name,
        clientName: affair.clientName ?? "",
        siteLabel: affair.siteLabel ?? "",
        contactName: "Ancien contact",
        contactPhone: "0102030405",
        contactEmail: "ancien@example.fr",
        description: "",
        nextAction: "",
      },
      actor,
    ).payload;

    const updated = applyCommercialMutation(
      withLegacyContact,
      {
        action: "updateDetails",
        caseId: affair.id,
        name: "Cuisine Dupont rénovée",
        clientName: "Dupont",
        siteLabel: "Roanne centre",
        contactName: "Ancien contact",
        contactPhone: "0102030405",
        contactEmail: "ancien@example.fr",
        description: "Nouvelle description",
        nextAction: "Rappeler vendredi",
      },
      actor,
    ).payload.cases[0];

    expect(updated.name).toBe("Cuisine Dupont rénovée");
    expect(updated.siteLabel).toBe("Roanne centre");
    expect(updated.contactName).toBe("Ancien contact");
    expect(updated.contactPhone).toBe("0102030405");
    expect(updated.contactEmail).toBe("ancien@example.fr");
  });

  it("stores a chantier address override only when the affair needs one", () => {
    const created = applyCommercialMutation(
      createInitialCommercialPayload(),
      {
        action: "create",
        name: "Banque - accueil",
        clientName: "Banque Exemple",
        siteLabel: "Agence centre-ville",
        siteAddressOverride: {
          addressLine1: "12 rue du Chantier",
          addressLine2: "Bâtiment B",
          postalCode: "42300",
          city: "Roanne",
        },
        reviewDate: "2026-09-20",
        description: "",
        nextAction: "",
      },
      actor,
    ).payload;
    const affair = created.cases[0];

    expect(affair.siteAddressOverride).toEqual({
      addressLine1: "12 rue du Chantier",
      addressLine2: "Bâtiment B",
      postalCode: "42300",
      city: "Roanne",
    });

    const revertedToClientAddress = applyCommercialMutation(
      created,
      {
        action: "updateDetails",
        caseId: affair.id,
        name: affair.name,
        clientName: affair.clientName ?? "",
        siteLabel: affair.siteLabel ?? "",
        siteAddressOverride: null,
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        description: "",
        nextAction: "",
      },
      actor,
    ).payload.cases[0];

    expect(revertedToClientAddress.siteAddressOverride).toBeNull();
  });
});
