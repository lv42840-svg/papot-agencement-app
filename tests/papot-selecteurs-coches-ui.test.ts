import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function ui(path: string): string {
  return readFileSync(path, "utf8");
}

describe("sélecteurs à coches et recherche PAPOT", () => {
  it("fournisseurs frais généraux : recherche, cases, confirmation et conservation des préférences", () => {
    const purchases = ui("src/components/purchase-orders-workspace.tsx");
    expect(purchases).toContain('aria-label="Filtrer les fournisseurs pour frais généraux"');
    expect(purchases).toContain('label="Fournisseurs affectés par défaut aux frais généraux"');
    expect(purchases).toContain("selectedIds={preferenceDraft}");
    expect(purchases).toContain("onChange={setPreferenceDraft}");
    expect(purchases).toContain("saveSupplierPreferences()");
    expect(purchases).not.toContain("Ctrl/Maj");
  });

  it("les listes de BC filtrent par clients et fournisseurs sélectionnés", () => {
    const purchases = ui("src/components/purchase-orders-workspace.tsx");
    expect(purchases).toContain("Filtrer les clients des commandes");
    expect(purchases).toContain("Filtrer les fournisseurs des commandes");
    expect(purchases).toContain("selectedIds={clientFilterNames}");
    expect(purchases).toContain("selectedIds={supplierFilterNames}");
    expect(purchases).toContain("clientFilterNames.includes(client)");
    expect(purchases).toContain("supplierFilterNames.includes(order.supplierName)");
  });

  it("un BC neuf ou modifié sélectionne un fournisseur avec recherche sans Ctrl", () => {
    const picker = ui("src/components/pennylane-supplier-picker.tsx");
    const purchases = ui("src/components/purchase-orders-workspace.tsx");
    const edit = ui("src/components/purchase-order-edit-workspace.tsx");
    expect(picker).toContain('type="search"');
    expect(picker).toContain('multiple={false}');
    expect(picker).toContain("visibleSuppliers");
    expect(purchases).toContain("<PennylaneSupplierPicker");
    expect(edit).toContain("<PennylaneSupplierPicker");
  });

  it("la recherche client permet un chantier unique à la création et à la modification d'un BC", () => {
    const creation = ui("src/components/purchase-orders-workspace.tsx");
    const modification = ui("src/components/purchase-order-edit-workspace.tsx");
    expect(creation).toContain('label="Chantier du BC détaillé (choix unique)"');
    expect(creation).toContain('aria-label="Rechercher un chantier pour le BC détaillé"');
    expect(creation).toContain("selectedIds={selected ? [selected] : []}");
    expect(modification).toContain('label="Chantier du BC à modifier (choix unique)"');
    expect(modification).toContain("disabled: site.status !== \"ACTIVE\" && site.id !== siteId");
    expect(modification).toContain('aria-label="Filtrer les chantiers dans le BC détaillé"');
  });

  it("destination multiple d'un BC : cases à cocher, filtre de nom conservé", () => {
    const component = ui("src/components/purchase-destination-multi-picker.tsx");
    const purchases = ui("src/components/purchase-orders-workspace.tsx");
    expect(component).toContain("<CheckboxChoiceList");
    expect(component).not.toContain("<select");
    expect(purchases).toContain('aria-label="Filtrer les destinations du BC"');
    expect(purchases).toContain("<PurchaseDestinationMultiPicker");
  });

  it("chantiers des heures : recherche par nom et client, coches au lieu de Ctrl", () => {
    const hours = ui("src/components/actual-hours-workspace.tsx");
    expect(hours).toContain('aria-label="Filtrer les chantiers à ajouter"');
    expect(hours).toContain('label="Chantiers à ajouter"');
    expect(hours).toContain("selectedIds={extraChoices}");
    expect(hours).toContain("onChange={setExtraChoices}");
    expect(hours).not.toContain("Utilise Ctrl ou Maj");
  });

  it("les éléments choisis restent sélectionnés lorsque la liste est filtrée", () => {
    const component = ui("src/components/checkbox-choice-list.tsx");
    expect(component).toContain('type="checkbox"');
    expect(component).toContain("checkVisibleChoices");
    expect(component).toContain("uncheckVisibleChoices");
    expect(component).toContain("toggleCheckboxChoice");
  });
});
