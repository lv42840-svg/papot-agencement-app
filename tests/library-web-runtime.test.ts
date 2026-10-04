import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "../src/app/devis/bibliotheque/page.tsx",
  "../src/app/api/desktop/library/route.ts",
] as const;

describe("quote library web runtime", () => {
  it("does not initialize the desktop runtime from the web library", () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf-8");
      expect(source).not.toContain("requireDesktopRequestContext");
      expect(source).toContain("requireModuleRequestContext");
    }
  });
});
