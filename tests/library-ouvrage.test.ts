import { describe, expect, it } from "vitest";
import { parseLibraryOuvrage } from "../src/lib/library/ouvrage";

function minimalOuvrage() {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Meuble bas mélaminé 2 portes",
    description: "Ouvrage standard de bibliothèque.",
    components: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        componentId: "22222222-2222-4222-8222-222222222222",
        quantity: 2.5,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        componentId: "44444444-4444-4444-8444-444444444444",
        quantity: 4,
      },
    ],
  };
}

describe("library ouvrage model", () => {
  it("accepts an ouvrage composed of component references and quantities", () => {
    expect(parseLibraryOuvrage(minimalOuvrage())).toEqual(minimalOuvrage());
  });

  it("allows an empty description", () => {
    const ouvrage = {
      ...minimalOuvrage(),
      description: "",
    };

    expect(parseLibraryOuvrage(ouvrage)).toEqual(ouvrage);
  });

  it("normalizes surrounding whitespace in text fields", () => {
    const ouvrage = parseLibraryOuvrage({
      ...minimalOuvrage(),
      name: "  Meuble haut  ",
      description: "  Avec deux portes  ",
    });

    expect(ouvrage).toMatchObject({
      name: "Meuble haut",
      description: "Avec deux portes",
    });
  });

  it("requires at least one component line", () => {
    expect(() => parseLibraryOuvrage({ ...minimalOuvrage(), components: [] })).toThrow(
      "LIBRARY_OUVRAGE_INVALID",
    );
  });

  it("requires valid ouvrage, line and component identities", () => {
    expect(() => parseLibraryOuvrage({ ...minimalOuvrage(), id: "not-a-uuid" })).toThrow(
      "LIBRARY_OUVRAGE_INVALID",
    );

    const [firstLine, ...otherLines] = minimalOuvrage().components;
    expect(() =>
      parseLibraryOuvrage({
        ...minimalOuvrage(),
        components: [{ ...firstLine, id: "not-a-uuid" }, ...otherLines],
      }),
    ).toThrow("LIBRARY_OUVRAGE_INVALID");

    expect(() =>
      parseLibraryOuvrage({
        ...minimalOuvrage(),
        components: [{ ...firstLine, componentId: "not-a-uuid" }, ...otherLines],
      }),
    ).toThrow("LIBRARY_OUVRAGE_INVALID");
  });

  it("requires strictly positive finite quantities", () => {
    const [firstLine, ...otherLines] = minimalOuvrage().components;

    for (const quantity of [0, -1, Infinity, Number.NaN]) {
      expect(() =>
        parseLibraryOuvrage({
          ...minimalOuvrage(),
          components: [{ ...firstLine, quantity }, ...otherLines],
        }),
      ).toThrow("LIBRARY_OUVRAGE_INVALID");
    }
  });

  it("rejects duplicate composition line identities", () => {
    const ouvrage = minimalOuvrage();
    const [firstLine, secondLine] = ouvrage.components;

    expect(() =>
      parseLibraryOuvrage({
        ...ouvrage,
        components: [firstLine, { ...secondLine, id: firstLine.id }],
      }),
    ).toThrow("LIBRARY_OUVRAGE_LINE_ID_DUPLICATE");
  });
});
