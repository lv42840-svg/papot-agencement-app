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

describe("chantier close reopen permission", () => {
  it("exposes a capability backed by the dedicated special permission", () => {
    expect(routeSource).toContain('"chantiers.close_reopen"');
    expect(routeSource).toContain("canCloseReopen");
    expect(routeSource).toContain("canWrite && canCloseReopenSpecial");
  });

  it("hides close and reopen actions when the capability is absent", () => {
    expect(uiSource).toContain('chantier.status === "ACTIVE" && capabilities.canCloseReopen');
    expect(uiSource).toContain("canManageDoneLifecycle");
    expect(uiSource).toContain("{capabilities.canCloseReopen ? (");
  });
});
