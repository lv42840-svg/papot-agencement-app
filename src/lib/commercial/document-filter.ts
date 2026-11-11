import type { CommercialDocument, CommercialDocumentCategory } from "./domain";

export type CommercialDocumentFilter = "ALL" | CommercialDocumentCategory;

export function filterCommercialDocuments(
  documents: readonly CommercialDocument[],
  filtre: CommercialDocumentFilter,
): CommercialDocument[] {
  if (filtre === "ALL") return [...documents];
  return documents.filter((document) => document.category === filtre);
}
