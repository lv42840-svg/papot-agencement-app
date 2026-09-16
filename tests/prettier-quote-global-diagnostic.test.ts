import { readFileSync } from "node:fs";
import prettier from "prettier";
import { describe, it } from "vitest";

describe("prettier quote global diagnostic", () => {
  it("prints the exact formatted quote global test", async () => {
    const source = readFileSync("tests/quote-global-flow.test.ts", "utf8");
    const formatted = await prettier.format(source, {
      parser: "typescript",
      semi: true,
      singleQuote: false,
      trailingComma: "all",
      printWidth: 100,
    });
    console.log(`PRETTIER_QUOTE_GLOBAL_START\n${formatted}PRETTIER_QUOTE_GLOBAL_END`);
  });
});
