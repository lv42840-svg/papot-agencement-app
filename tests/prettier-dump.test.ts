import { readFileSync } from "node:fs";
import { format } from "prettier";
import { describe, it } from "vitest";

const files = [
  "src/components/quote-direct-editor.tsx",
  "src/components/quote-inline-text-color-toolbar.tsx",
  "tests/quote-inline-text-color.test.ts",
];

describe("temporary prettier dump", () => {
  it("prints exact formatted sources", async () => {
    for (const path of files) {
      const source = readFileSync(path, "utf-8");
      const formatted = await format(source, { parser: "typescript" });
      const encoded = Buffer.from(formatted, "utf-8").toString("base64");
      console.log(`PRETTIER_BASE64 ${path} ${encoded}`);
    }
  });
});
