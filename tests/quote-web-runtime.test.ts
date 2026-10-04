import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "../src/app/devis/page.tsx",
  "../src/app/devis/nouveau/page.tsx",
  "../src/app/devis/[quoteId]/page.tsx",
  "../src/app/devis/bibliotheque/page.tsx",
  "../src/app/api/desktop/quotes/route.ts",
  "../src/app/api/desktop/quotes/pricing/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/details/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/legal/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/notes/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/lifecycle/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/send/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/items/[itemId]/photos/[photoId]/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/items/[itemId]/photos/route.ts",
  "../src/app/api/desktop/quotes/[quoteId]/items/[itemId]/rich-text/route.ts",
] as const;

describe("Devis web runtime", () => {
  it("does not initialize the desktop runtime from web Devis routes", () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf-8");
      expect(source).not.toContain("requireDesktopRequestContext");
      expect(source).not.toContain(".owner.");
    }
  });
});
