import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);
const workspaceSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);
const gridSource = readFileSync(
  new URL("../src/components/planning-excel-grid.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning firm chantier order", () => {
  it("exposes a protected shared chantier order mutation", () => {
    expect(apiSource).toContain('input.action === "setChantierOrder"');
    expect(apiSource).toContain("applyPlanningChantierOrderMutation");
    expect(apiSource).toContain('"planning.edit_macro"');
  });

  it("allows authorized users to reorder whole chantier rows without changing hours", () => {
    expect(workspaceSource).toContain('action: "setChantierOrder"');
    expect(workspaceSource).toContain("moveFirm");
    expect(workspaceSource).toContain("onMoveFirm={moveFirm}");
    expect(gridSource).toContain("onMoveFirm(chantier.chantierId, -1)");
    expect(gridSource).toContain("onMoveFirm(chantier.chantierId, 1)");
    expect(gridSource).toContain("!snapshot.capabilities.canEditMacro");
  });
});
