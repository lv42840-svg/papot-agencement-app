import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chantierRoutes = [
  "../src/app/api/desktop/chantiers/route.ts",
  "../src/app/api/desktop/chantiers/launch/route.ts",
] as const;

const launchWorkspace = readFileSync(
  new URL("../src/components/chantiers-workspace-obat.tsx", import.meta.url),
  "utf-8",
);

describe("Chantiers web runtime", () => {
  it("does not initialize the desktop runtime from Chantier APIs", () => {
    for (const file of chantierRoutes) {
      const source = readFileSync(new URL(file, import.meta.url), "utf-8");
      expect(source).not.toContain("requireDesktopRequestContext");
      expect(source).toContain("requireModuleRequestContext");
    }
  });

  it("preserves the Commercial revision during launch preparation", () => {
    expect(launchWorkspace).toContain("expectedUpdatedAt: currentUpdatedAt");
    expect(launchWorkspace).toContain('form.set("expectedUpdatedAt", expectedUpdatedAt)');
    expect(launchWorkspace).toContain("setCommercialUpdatedAt(currentUpdatedAt)");
  });
});
