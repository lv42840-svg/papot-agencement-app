import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url),
  "utf-8",
);
const uiSource = readFileSync(
  new URL("../src/components/chantier-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("chantier close reopen planning bridge", () => {
  it("clears firm planning on close and reopens at the top without restoring cells", () => {
    expect(routeSource).toContain('input.action === "markDone"');
    expect(routeSource).toContain("closePlanningFirmChantier");
    expect(routeSource).toContain('input.action === "reactivate"');
    expect(routeSource).toContain("reopenPlanningFirmChantier");
  });

  it("requires the dedicated lifecycle capability and a free reason in the UI", () => {
    expect(uiSource).toContain("capabilities.canCloseReopen");
    expect(uiSource).toContain('placeholder="Motif obligatoire"');
    expect(uiSource).toContain('action: "markDone"');
    expect(uiSource).toContain("reason: closeReason");
    expect(uiSource).toContain('action: "reactivate"');
    expect(uiSource).toContain("reason: reactivateReason");
  });
});
