import { describe, expect, it } from "vitest";
import { parseCompanySearchResults } from "../src/lib/clients/company-lookup";

describe("Government company directory mapping", () => {
  it("returns the registered headquarters SIRET and address", () => {
    expect(
      parseCompanySearchResults({
        results: [
          {
            nom_complet: "MENUISERIE TEST",
            siege: {
              siret: "12345678901234",
              adresse: "10 RUE DU BOIS",
              code_postal: "42190",
              libelle_commune: "CHARLIEU",
            },
          },
        ],
      }),
    ).toEqual([
      {
        name: "MENUISERIE TEST",
        siret: "12345678901234",
        addressLine1: "10 RUE DU BOIS",
        postalCode: "42190",
        city: "CHARLIEU",
      },
    ]);
  });

  it("never invents a SIRET and filters malformed or duplicate records", () => {
    expect(
      parseCompanySearchResults({
        results: [
          { nom_complet: "INCOMPLETE", siege: null },
          { nom_raison_sociale: "VALID", siege: { siret: "98765432100012" } },
          { nom_raison_sociale: "DUPLICATE", siege: { siret: "98765432100012" } },
        ],
      }),
    ).toEqual([
      { name: "VALID", siret: "98765432100012", addressLine1: "", postalCode: "", city: "" },
    ]);
    expect(parseCompanySearchResults(null)).toEqual([]);
  });
});
