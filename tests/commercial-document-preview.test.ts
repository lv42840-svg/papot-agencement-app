import { describe, expect, it } from "vitest";
import { canPreviewCommercialDocument } from "../src/lib/commercial/document-preview";

describe("commercial document preview", () => {
  it("previews PDF and image documents inline", () => {
    expect(canPreviewCommercialDocument({ contentType: "application/pdf" })).toBe(true);
    expect(canPreviewCommercialDocument({ contentType: "image/jpeg" })).toBe(true);
    expect(canPreviewCommercialDocument({ contentType: "image/png" })).toBe(true);
  });

  it("keeps unsupported office documents out of the inline preview", () => {
    expect(
      canPreviewCommercialDocument({
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(false);
  });
});
