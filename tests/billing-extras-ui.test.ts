import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("suppléments de chantier", () => {
  it("permet d'enregistrer un supplément en attente d'accord et de documenter sa validation", () => {
    const view = readFileSync("src/components/billing-workspace.tsx", "utf8");
    const api = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    expect(view).toContain("Travaux supplémentaires du chantier");
    expect(view).toContain('action: "ADD_EXTRA"');
    expect(view).toContain('action: "CONFIRM_EXTRA"');
    expect(view).toContain("Confirmer l'accord et intégrer au marché");
    expect(api).toContain('z.literal("ADD_EXTRA")');
    expect(api).toContain('z.literal("CONFIRM_EXTRA")');
  });
});
