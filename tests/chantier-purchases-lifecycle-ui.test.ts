import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("raccordement BC et clôture chantier", () => {
  const api = readFileSync("src/app/api/desktop/chantiers/route.ts", "utf8");
  const ui = readFileSync("src/components/chantier-workspace.tsx", "utf8");
  const profit = readFileSync("src/components/chantier-profitability-panel.tsx", "utf8");
  it("affiche le budget achats et les BC engagés sans confondre le réel", () => {
    expect(api).toContain("committedPurchasesByChantier");
    expect(api).toContain("committedPurchaseTotal(purchasePayload, chantier.id)");
    expect(ui).toContain("committedPurchasesCents={");
    expect(profit).toContain("Achats engagés (BC) HT");
    expect(profit).toContain("Écart engagé - prévu HT");
    expect(profit).toContain("Dépassement du budget achats");
    expect(profit).toContain("En attente du rapprochement Pennylane");
  });
  it("demande un choix exprès de conserver ou retirer les BC en clôture", () => {
    expect(ui).toContain("purchaseWarning.count > 0");
    expect(ui).toContain('purchaseDecision === "KEEP"');
    expect(ui).toContain('purchaseDecision === "REMOVE"');
    expect(ui).toContain("removeConfirmed");
    expect(ui).toContain("purchaseWarning.token");
    expect(api).toContain('input.action === "markDone"');
    expect(api).toContain("CHANTIER_PURCHASE_REVIEW_REQUIRED");
    expect(api).toContain("CHANTIER_PURCHASE_REVIEW_CONFLICT");
    expect(api).toContain("removeChantierPurchaseCommitments");
  });
});
