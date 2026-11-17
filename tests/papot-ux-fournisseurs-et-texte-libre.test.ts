import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("retour terrain : achats et texte libre", () => {
  it("regroupe les trois actions en tête des BC et retire l'ancien texte explicatif", () => {
    const ui = source("src/components/purchase-orders-workspace.tsx");
    const orderHeader = ui.indexOf("<h1>Achats · Bons de commande</h1>");
    const supplierForm = ui.indexOf("Nouveau bon de commande");
    expect(orderHeader).toBeGreaterThan(-1);
    expect(supplierForm).toBeGreaterThan(orderHeader);
    for (const action of [
      "Factures fournisseurs · Pennylane",
      "Actualiser les fournisseurs",
      "Fournisseurs · Frais généraux",
    ]) {
      expect(ui.indexOf(action)).toBeGreaterThan(orderHeader);
      expect(ui.indexOf(action)).toBeLessThan(supplierForm);
    }
    expect(ui).not.toContain("Un BC enregistré est un");
    expect(ui).toContain("Fournisseur introuvable ? Crée-le dans Pennylane");
  });

  it("réutilise la recherche fournisseur dans les deux écrans BC", () => {
    const picker = source("src/components/pennylane-supplier-picker.tsx");
    expect(picker).toContain('type="search"');
    expect(picker).toContain("visibleSuppliers");
    expect(picker).toContain("selectedId");
    expect(source("src/components/purchase-orders-workspace.tsx")).toContain(
      "PennylaneSupplierPicker",
    );
    expect(source("src/components/purchase-order-edit-workspace.tsx")).toContain(
      "PennylaneSupplierPicker",
    );
  });

  it("enregistre plusieurs préférences fournisseur en une opération sécurisée", () => {
    const ui = source("src/components/purchase-orders-workspace.tsx");
    const api = source("src/app/api/desktop/purchases/route.ts");
    expect(ui).toContain("preferenceDraft");
    expect(ui).toContain("setPreferenceSearch");
    expect(ui).toContain("SET_SUPPLIER_PREFERENCES");
    expect(api).toContain("SET_SUPPLIER_PREFERENCES");
    expect(api).toContain('requireModuleRequestContext("purchases", "WRITE")');
    expect(api).toContain("catalog.synced");
    expect(api).toContain("supplierPennylaneIds");
    expect(ui).toContain("Enregistrer les préférences");
  });

  it("donne au commentaire du devis la même barre riche que les titres et ouvrages", () => {
    const form = source("src/components/quote-structured-lines-editor.tsx");
    const wrapper = source("src/components/quote-structured-lines-rich-editor.tsx");
    const layer = source("src/components/quote-rich-text-layer.tsx");
    const persistence = source("src/lib/quotes/rich-text-mutation.ts");
    expect(form).toContain("quoteCommentEditing");
    expect(wrapper).toContain(
      'type RichEditableKind = "SECTION" | "SUBSECTION" | "LINE" | "COMMENT"',
    );
    expect(wrapper).toContain(".quoteCommentEditing textarea");
    expect(wrapper).toContain("quoteRichInlineHost");
    expect(layer).toContain(".quoteCommentText");
    expect(persistence).toContain('if (item.kind === "COMMENT")');
  });
});
