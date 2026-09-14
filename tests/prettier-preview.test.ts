import { readFile } from "node:fs/promises";
import { format } from "prettier";
import { describe, it } from "vitest";

const paths = [
  "src/app/api/desktop/quotes/[quoteId]/send/route.ts",
  "src/components/commercial-affair-quotes.tsx",
  "src/lib/quotes/send.ts",
  "tests/commercial-quote-follow-up.test.ts",
];

describe("temporary prettier preview", () => {
  it("prints the exact expected formatting", async () => {
    for (const path of paths) {
      const source = await readFile(path, "utf8");
      const formatted = await format(source, {
        parser: "typescript",
        semi: true,
        singleQuote: false,
        trailingComma: "all",
        printWidth: 100,
      });
      console.log(`PRETTIER_BEGIN:${path}\n${formatted}PRETTIER_END:${path}`);
    }
  });
});
