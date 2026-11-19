import { describe, expect, it, vi } from "vitest";
import {
  headquartersSiretForSiren,
  findHeadquartersSiret,
} from "../src/lib/pennylane/customer-siret";

describe("SIRET du siège pour un SIREN Pennylane", () => {
  it("choisit uniquement le SIRET du siège dont le SIREN est identique", () => {
    const data = {
      results: [
        { siren: "999999999", siege: { siret: "99999999900015" } },
        { siren: "123456789", siege: { siret: "12345678900012" } },
      ],
    };
    expect(headquartersSiretForSiren("123456789", data)).toBe("12345678900012");
    expect(headquartersSiretForSiren("123456780", data)).toBe("");
  });

  it("ne fabrique jamais un SIRET manquant ou incohérent", () => {
    expect(headquartersSiretForSiren("123456789", {})).toBe("");
    expect(
      headquartersSiretForSiren("123456789", {
        results: [{ siren: "123456789", siege: { siret: "00000000000000" } }],
      }),
    ).toBe("");
    expect(
      headquartersSiretForSiren("123", {
        results: [{ siren: "123", siege: { siret: "12300000000000" } }],
      }),
    ).toBe("");
  });

  it("interroge seulement l'annuaire public avec le SIREN et tolère une panne", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe(
        "https://recherche-entreprises.api.gouv.fr/search?q=123456789&per_page=1",
      );
      return Response.json({
        results: [{ siren: "123456789", siege: { siret: "12345678900012" } }],
      });
    });
    expect(await findHeadquartersSiret("123456789", fetcher)).toBe("12345678900012");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await findHeadquartersSiret("INVALID", fetcher)).toBe("");
    expect(fetcher).toHaveBeenCalledOnce();

    const failed = vi.fn<typeof fetch>(async () => {
      throw new Error("Network down");
    });
    expect(await findHeadquartersSiret("123456789", failed)).toBe("");
  });
});
