import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);
const uiSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning firm chantier order", () => {
  it("exposes a protected shared chantier order mutation", () => {
    expect(apiSource).toContain('input.action === "setChantierOrder"');
    expect(apiSource).toContain("applyPlanningChantierOrderMutation");
    expect(apiSource).toContain('"planning.edit_macro"');
  });

  it("allows authorized users to move active chantiers without touching hours", () => {
    expect(uiSource).toContain('action: "setChantierOrder"');
    expect(uiSource).toContain("moveFirm");
    expect(uiSource).toContain("Monter ${chantier.name} dans les chantiers fermes");
    expect(uiSource).toContain("Descendre ${chantier.name} dans les chantiers fermes");
  });
});
