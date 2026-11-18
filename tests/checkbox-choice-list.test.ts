import { describe, expect, it } from "vitest";
import {
  checkVisibleChoices,
  toggleCheckboxChoice,
  uncheckVisibleChoices,
} from "../src/lib/ui/checkbox-selection";

describe("cases à cocher filtrables PAPOT", () => {
  it("cocher un élément laisse les autres sélectionnés, même hors du filtre", () => {
    expect(toggleCheckboxChoice(["client-caché"], "client-visible", true)).toEqual([
      "client-caché",
      "client-visible",
    ]);
    expect(toggleCheckboxChoice(["client-caché", "client-visible"], "client-visible", false)).toEqual([
      "client-caché",
    ]);
    expect(toggleCheckboxChoice(["client-caché"], "client-caché", true)).toEqual(["client-caché"]);
  });

  it("les actions de masse ne concernent que les résultats filtrés", () => {
    expect(checkVisibleChoices(["FG-hors-recherche"], ["FG-a", "FG-b"])).toEqual([
      "FG-hors-recherche",
      "FG-a",
      "FG-b",
    ]);
    expect(uncheckVisibleChoices(["FG-hors-recherche", "FG-a", "FG-b"], ["FG-a"])).toEqual([
      "FG-hors-recherche",
      "FG-b",
    ]);
  });

  it("une commande garde un seul fournisseur ou chantier sélectionné", () => {
    expect(toggleCheckboxChoice(["fournisseur-1"], "fournisseur-2", true, false)).toEqual([
      "fournisseur-2",
    ]);
    expect(toggleCheckboxChoice(["fournisseur-2"], "fournisseur-2", false, false)).toEqual([]);
  });
});
