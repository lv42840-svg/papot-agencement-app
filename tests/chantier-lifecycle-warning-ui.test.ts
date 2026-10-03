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

describe("chantier lifecycle planning warning UI", () => {
  it("branches the existing chantier snapshot to planning close warnings", () => {
    expect(routeSource).toContain("buildChantierPlanningCloseWarning");
    expect(routeSource).toContain("planningCloseWarnings");
  });

  it("keeps closure non-blocking while requiring a lifecycle reason", () => {
    expect(uiSource).toContain("chantierLifecycleWarning");
    expect(uiSource).toContain("Motif obligatoire de fermeture");
    expect(uiSource).toContain("Motif obligatoire de réouverture");
    expect(uiSource).toContain('action: "markDone"');
    expect(uiSource).toContain("reason: closeReason");
    expect(uiSource).toContain("remainingToAllocateHours");
    expect(uiSource).toContain("futureAllocatedHours");
  });
});
