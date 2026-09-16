import { readFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { expect, it } from "vitest";

const files = [
  "src/components/quote-rich-text-editor.tsx",
  "src/components/quote-structured-lines-rich-editor.tsx",
  "tests/quote-rich-text-inline-bridge.test.ts",
  "tests/quote-rich-text-line-breaks.test.ts",
  "tests/quote-rich-text-ui.test.ts",
];

for (const file of files) {
  it(`matches Prettier: ${file}`, async () => {
    const absolute = path.join(process.cwd(), file);
    const source = readFileSync(absolute, "utf8");
    const config = (await prettier.resolveConfig(absolute)) ?? {};
    const formatted = await prettier.format(source, { ...config, filepath: absolute });
    expect(source).toBe(formatted);
  });
}