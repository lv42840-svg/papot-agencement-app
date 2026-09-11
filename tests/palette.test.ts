import { describe, expect, it } from "vitest";
import { accentPalette, isAccentKey } from "../src/lib/theme/palette";

describe("accent palette", () => {
  it("keeps lavender as a predefined accessible default", () => {
    expect(isAccentKey("lavender")).toBe(true);
    expect(accentPalette.lavender.foreground).toBe("#FFFFFF");
  });
  it("rejects arbitrary colors", () => expect(isAccentKey("#ff00ff")).toBe(false));
});
