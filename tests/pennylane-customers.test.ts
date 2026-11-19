import { describe, expect, it } from "vitest";
import {
  mergePennylaneIdentity,
  normalizePennylaneCustomer,
  possibleClientMatches,
} from "../src/lib/pennylane/customers";
import type { ClientRecord } from "../src/lib/clients/domain";

const provider = {
  id: 42,
  name: "Entreprise Pralus",
  customer_type: "company",
  reg_no: "123456789",
  electronic_billing_address: "123456789_00012",
  vat_number: "FR12345678901",
  phone: "0477777777",
  emails: ["compta@example.org"],
  billing_address: {
    address: "4 rue de la Gare",
    postal_code: "42190",
    city: "Charlieu",
    country_alpha2: "FR",
  },
  payment_conditions: "30_days_end_of_month",
  updated_at: "2026-11-16T10:00:00Z",
};

function existing(): ClientRecord {
  const now = "2026-11-15T10:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "ENTREPRISE",
    companyName: "Entreprise Pralus",
    firstName: "",
    lastName: "",
    addressLine1: "Ancienne adresse",
    addressLine2: "",
    postalCode: "42190",
    city: "Charlieu",
    phone: "",
    email: "",
    siret: "12345678900012",
    vatNumber: "",
    paymentTerms: "Comptant",
    defaultVatRatePercent: 10,
    notes: "Numéro de badge et informations du chantier",
    contacts: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        firstName: "Nadia",
        lastName: "Martin",
        role: "Assistante",
        phone: "",
        email: "",
        isPrimary: true,
      },
    ],
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    createdByName: "PAPOT",
    updatedAt: now,
    updatedByName: "PAPOT",
  };
}

describe("import clients Pennylane en lecture seule", () => {
  it("utilise le SIRET complet sans confondre avec le SIREN de 9 chiffres", () => {
    const c = normalizePennylaneCustomer(provider);
    expect(c.fields.siret).toBe("12345678900012");
    expect(c.fields.paymentTerms).toBe("30 jours fin de mois");
    expect(c.fields.city).toBe("Charlieu");
    expect(c.fields.email).toBe("compta@example.org");
    expect(
      normalizePennylaneCustomer({
        ...provider,
        electronic_billing_address: null,
      }).fields.siret,
    ).toBe("");
  });

  it("reconnaît les formats SIREN_SIRET à 14 chiffres de Pennylane", () => {
    const address = "123456789_12345678900012";
    const customer = normalizePennylaneCustomer({
      ...provider,
      electronic_billing_address: address,
    });
    expect(customer.fields.siret).toBe("12345678900012");
    expect(customer.siren).toBe("123456789");
    expect(
      normalizePennylaneCustomer({
        ...provider,
        electronic_billing_address: address + "_comptabilite",
      }).fields.siret,
    ).toBe("12345678900012");
    expect(
      normalizePennylaneCustomer({
        ...provider,
        electronic_billing_address: "123456789",
      }).fields.siret,
    ).toBe("");
  });

  it("ne transforme pas un SIREN seul en SIRET et vérifie les établissements", () => {
    const customer = normalizePennylaneCustomer({
      ...provider,
      electronic_billing_address: null,
    });
    expect(customer.siren).toBe("123456789");
    expect(customer.fields.siret).toBe("");
    expect(() =>
      mergePennylaneIdentity({ ...existing(), siret: "98765432100012" }, customer, "Nadia"),
    ).toThrow("PENNYLANE_CLIENT_SIRET_CONFLICT");
  });

  it("refuse une adresse électronique incompatible avec le SIREN", () => {
    const c = normalizePennylaneCustomer({
      ...provider,
      electronic_billing_address: "987654321_00012",
    });
    expect(c.fields.siret).toBe("");
  });

  it("prend en charge les particuliers sans inventer de SIRET", () => {
    const c = normalizePennylaneCustomer({
      id: 43,
      customer_type: "individual",
      first_name: "Alice",
      last_name: "Martin",
      name: "Alice Martin",
      emails: ["alice@example.org"],
    });
    expect(c.fields.type).toBe("PARTICULIER");
    expect(c.fields.firstName).toBe("Alice");
    expect(c.fields.lastName).toBe("Martin");
    expect(c.fields.siret).toBe("");
  });

  it("détecte une fiche déjà existante et conserve son UUID, notes, contacts et TVA", () => {
    const c = normalizePennylaneCustomer(provider);
    const old = existing();
    expect(possibleClientMatches(c, [old]).map((item) => item.id)).toEqual([old.id]);
    const updated = mergePennylaneIdentity(old, c, "Nadia", new Date("2026-11-16T12:00:00Z"));
    expect(updated.id).toBe(old.id);
    expect(updated.pennylaneId).toBe("42");
    expect(updated.notes).toBe(old.notes);
    expect(updated.contacts).toEqual(old.contacts);
    expect(updated.defaultVatRatePercent).toBe(10);
    expect(updated.companyName).toBe("Entreprise Pralus");
    expect(updated.addressLine1).toBe("4 rue de la Gare");
  });

  it("refuse une association avec des identités déjà contradictoires", () => {
    const c = normalizePennylaneCustomer(provider);
    expect(() =>
      mergePennylaneIdentity(
        {
          ...existing(),
          pennylaneId: "999",
        },
        c,
        "Nadia",
      ),
    ).toThrow("PENNYLANE_CLIENT_LINK_CONFLICT");
    expect(() =>
      mergePennylaneIdentity(
        {
          ...existing(),
          siret: "98765432100010",
        },
        c,
        "Nadia",
      ),
    ).toThrow("PENNYLANE_CLIENT_SIRET_CONFLICT");
  });

  it("refuse les fiches sans nom exploitable au lieu de créer des doublons sans identité", () => {
    expect(() =>
      normalizePennylaneCustomer({
        ...provider,
        name: "",
      }),
    ).toThrow("PENNYLANE_CUSTOMER_DATA_INVALID");
  });
});
