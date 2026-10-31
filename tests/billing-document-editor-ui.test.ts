import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("facturation: éditeur identique au parcours devis", () => {
  it("ouvre une page dédiée après création depuis devis ou chantier", () => {
    const list = readFileSync("src/components/billing-workspace.tsx", "utf8");
    const quote = readFileSync("src/components/quote-direct-editor.tsx", "utf8");
    const site = readFileSync("src/components/chantier-workspace.tsx", "utf8");
    const page = readFileSync("src/app/facturation/[draftId]/page.tsx", "utf8");
    expect(list).toContain("router.push(");
    expect(list).toContain("Ouvrir et modifier la facture");
    expect(quote).toContain("/facturation?quoteId=");
    expect(site).toContain("/facturation?chantierId=");
    expect(page).toContain("<BillingDocumentEditor draftId={draftId} />");
  });

  it("propose directement le pourcentage global pour un acompte et par ligne pour une situation", () => {
    const ui = readFileSync("src/components/billing-workspace.tsx", "utf8");
    expect(ui).toContain('useState<BillingType>("DEPOSIT")');
    expect(ui).toContain('useState<"AMOUNT" | "PERCENT" | "LINES">("PERCENT")');
    expect(ui).toContain('setMode(e.target.value === "PROGRESS" ? "LINES" : "PERCENT")');
    expect(ui).toContain("Avancement par ligne (%)");
    expect(ui).toContain("router.push(`/facturation/");
  });

  it("permet modification, ajout, titres et réorganisation sans émettre la facture", () => {
    const ui = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    const api = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    expect(ui).toContain("Ajouter une ligne");
    expect(ui).toContain("Nouveau titre");
    expect(ui).toContain("Prix unitaire HT");
    expect(ui).toContain("Quantité ligne");
    expect(ui).toContain("Avancement");
    expect(ui).toContain("Enregistrer le projet");
    expect(ui).toContain("PROJET · NON ÉMIS");
    expect(ui).toContain("UPDATE_DOCUMENT");
    expect(api).toContain('z.literal("UPDATE_DOCUMENT")');
    expect(api).toContain("updateBillingDocument");
  });
});
