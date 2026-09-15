import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT,
  COMMERCIAL_DOCUMENT_PREVIEW_MAX_HEIGHT,
  COMMERCIAL_DOCUMENT_PREVIEW_MIN_HEIGHT,
  canPreviewCommercialDocument,
  clampCommercialDocumentPreviewHeight,
} from "../src/lib/commercial/document-preview";

describe("commercial document preview", () => {
  it("previews PDF and image documents inline", () => {
    expect(canPreviewCommercialDocument({ contentType: "application/pdf" })).toBe(true);
    expect(canPreviewCommercialDocument({ contentType: "image/jpeg" })).toBe(true);
    expect(canPreviewCommercialDocument({ contentType: "image/png" })).toBe(true);
  });

  it("keeps unsupported office documents download-only", () => {
    expect(
      canPreviewCommercialDocument({
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(false);
  });

  it("keeps the adjustable preview height inside safe bounds", () => {
    expect(clampCommercialDocumentPreviewHeight(120)).toBe(
      COMMERCIAL_DOCUMENT_PREVIEW_MIN_HEIGHT,
    );
    expect(clampCommercialDocumentPreviewHeight(520)).toBe(520);
    expect(clampCommercialDocumentPreviewHeight(1400)).toBe(
      COMMERCIAL_DOCUMENT_PREVIEW_MAX_HEIGHT,
    );
    expect(clampCommercialDocumentPreviewHeight(Number.NaN)).toBe(
      COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT,
    );
  });
});
