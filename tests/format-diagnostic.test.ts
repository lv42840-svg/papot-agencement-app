import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

const files = [
  "src/app/devis/[quoteId]/page.tsx",
  "src/lib/quotes/store.ts",
  "tests/quote-general-details.test.ts",
  "tests/quote-general-info-ui.test.ts",
];

describe("format diagnostic", () => {
  it("prints the exact prettier diff for the remaining files", () => {
    execFileSync("node_modules/.bin/prettier", ["--write", ...files], {
      stdio: "pipe",
    });
    const diff = execFileSync("git", ["diff", "--", ...files], {
      encoding: "utf-8",
    });
    console.log("PRETTIER_DIFF_BEGIN\n" + diff + "PRETTIER_DIFF_END");
  });
});
