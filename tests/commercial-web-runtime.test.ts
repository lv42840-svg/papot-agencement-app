import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "../src/app/api/desktop/commercial/route.ts",
  "../src/app/api/desktop/commercial/[caseId]/documents/route.ts",
  "../src/app/api/desktop/commercial/[caseId]/documents/[documentId]/route.ts",
  "../src/app/api/desktop/commercial/[caseId]/folder/route.ts",
  "../src/app/api/desktop/affaires/[caseId]/documents/[documentId]/route.ts",
] as const;

describe("Commercial web runtime", () => {
  it("does not initialize the desktop runtime from Commercial/Affaires routes", () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf-8");
      expect(source).not.toContain("requireDesktopRequestContext");
      expect(source).not.toContain(".owner.");
      expect(source).toContain("requireModuleRequestContext");
    }
  });
});
