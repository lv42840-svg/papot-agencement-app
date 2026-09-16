import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "prettier";
import { describe, it } from "vitest";

const files = [
  "src/app/devis/[quoteId]/page.tsx",
  "src/lib/quotes/store.ts",
  "tests/quote-general-details.test.ts",
  "tests/quote-general-info-ui.test.ts",
];

describe("format diagnostic", () => {
  it("prints exact prettier diffs without touching source files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "papot-prettier-"));

    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      const formatted = await format(source, {
        filepath: file,
        printWidth: 100,
        semi: true,
        singleQuote: false,
        trailingComma: "all",
      });
      if (formatted === source) continue;

      const formattedPath = join(directory, file.replaceAll("/", "__"));
      writeFileSync(formattedPath, formatted);

      let diff = "";
      try {
        execFileSync("diff", ["-u", file, formattedPath], { encoding: "utf-8" });
      } catch (error) {
        if (error && typeof error === "object" && "stdout" in error) {
          diff = String(error.stdout);
        }
      }
      console.log(`PRETTIER_DIFF_FILE:${file}\n${diff}PRETTIER_DIFF_END_FILE:${file}`);
    }
  });
});
