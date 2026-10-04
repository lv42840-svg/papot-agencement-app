import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  new URL("../src/app/api/me/accent/route.ts", import.meta.url),
  "utf-8",
);
const uiSource = readFileSync(
  new URL("../src/components/accent-picker.tsx", import.meta.url),
  "utf-8",
);

describe("accent preference concurrency", () => {
  it("sends the displayed accent as the stale-write precondition", () => {
    expect(uiSource).toContain("expectedAccentKey: accent");
    expect(apiSource).toContain("PREFERENCE_VERSION_REQUIRED");
    expect(apiSource).toContain("PREFERENCE_VERSION_CONFLICT");
    expect(apiSource).toContain("target.accentKey !== body.expectedAccentKey");
  });
});
