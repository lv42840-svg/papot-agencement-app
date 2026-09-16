import { readFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { expect, it } from "vitest";

it("prints exact Prettier output for the two pending files", async () => {
  const files = [
    "src/components/quote-structured-lines-rich-editor.tsx",
    "tests/quote-rich-text-inline-bridge.test.ts",
  ];

  for (const file of files) {
    const absolute = path.join(process.cwd(), file);
    const source = readFileSync(absolute, "utf8");
    const config = (await prettier.resolveConfig(absolute)) ?? {};
    const formatted = await prettier.format(source, { ...config, filepath: absolute });
    console.log(`PRETTIER_OUTPUT_START:${file}\n${formatted}PRETTIER_OUTPUT_END:${file}`);
  }

  expect.fail("PRETTIER_PROBE_COMPLETE");
});
