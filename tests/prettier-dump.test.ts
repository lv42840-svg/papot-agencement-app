import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { format, resolveConfig } from "prettier";
import { describe, it } from "vitest";

const files = [
  "src/components/quote-direct-editor.tsx",
  "src/components/quote-inline-text-color-toolbar.tsx",
  "tests/quote-inline-text-color.test.ts",
];

describe("temporary prettier dump", () => {
  it("prints exact formatting diffs with repository config", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "papot-prettier-"));

    for (const path of files) {
      const source = readFileSync(path, "utf-8");
      const config = (await resolveConfig(path)) ?? {};
      const formatted = await format(source, { ...config, filepath: path });
      const formattedPath = join(tempRoot, basename(path));
      writeFileSync(formattedPath, formatted, "utf-8");

      try {
        execFileSync("diff", ["-u", path, formattedPath], { encoding: "utf-8" });
      } catch (diffError) {
        const output = (diffError as { stdout?: string }).stdout ?? "";
        console.log(`PRETTIER_DIFF ${path}\n${output}`);
      }
    }
  });
});
