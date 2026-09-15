import { describe, expect, it } from "vitest";
import {
  filterCommercialDocuments,
  type CommercialDocumentFilter,
} from "../src/lib/commercial/document-filter";
import type { CommercialDocument, CommercialDocumentCategory } from "../src/lib/commercial/domain";

function document(
  id: string,
  category: CommercialDocumentCategory,
  fileName: string,
): CommercialDocument {
  return {
    id,
    fileName,
    contentType: "application/pdf",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    storagePath: `Commercial/2026/Client_Affaire/${category}/${fileName}`,
    category,
    versionLabel: null,
    variantLabel: null,
    isCurrent: true,
    isSignedQuote: false,
    uploadedAt: "2026-09-15T06:00:00.000Z",
    uploadedByName: "Test User",
  };
}

const documents = [
  document("11111111-1111-4111-8111-111111111111", "RECEIVED", "plan.pdf"),
  document("22222222-2222-4222-8222-222222222222", "MISC", "photo.pdf"),
  document("33333333-3333-4333-8333-333333333333", "RECEIVED", "mail.pdf"),
];

describe("commercial document filter", () => {
  it("keeps every document with the Tous filter", () => {
    expect(filterCommercialDocuments(documents, "ALL").map((item) => item.fileName)).toEqual([
      "plan.pdf",
      "photo.pdf",
      "mail.pdf",
    ]);
  });

  it("keeps only documents from the selected type", () => {
    expect(filterCommercialDocuments(documents, "RECEIVED").map((item) => item.fileName)).toEqual([
      "plan.pdf",
      "mail.pdf",
    ]);
  });

  it("returns an empty list when the selected type has no document", () => {
    const filter: CommercialDocumentFilter = "QUOTE";
    expect(filterCommercialDocuments(documents, filter)).toEqual([]);
  });
});
