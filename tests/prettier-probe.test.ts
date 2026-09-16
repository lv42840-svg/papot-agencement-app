import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

const FILES = [
  "src/components/quote-rich-text-editor.tsx",
  "src/components/quote-rich-text-layer.tsx",
  "src/lib/quotes/rich-text-mutation.ts",
];

describe("temporary prettier probe", () => {
  it("prints the exact prettier diff", () => {
    execFileSync("npx", ["prettier", "--write", ...FILES], { stdio: "pipe" });
    const diff = execFileSync("git", ["diff", "--", ...FILES], {
      encoding: "utf8",
    });
    console.log("PRETTIER_DIFF_START\n" + diff + "\nPRETTIER_DIFF_END");
  });
});
