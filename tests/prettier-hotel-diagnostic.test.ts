import { readFileSync } from "node:fs";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/quote-pricing-adjustments-editor.tsx", import.meta.url),
  "utf-8",
);

describe("hotel editor formatting diagnostic", () => {
  it("prints the repository-formatted source", async () => {
    const formatted = await prettier.format(source, {
      parser: "typescript",
      semi: true,
      singleQuote: false,
      trailingComma: "all",
      printWidth: 100,
    });

    console.log("PRETTIER_HOTEL_START\n" + formatted + "PRETTIER_HOTEL_END");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
