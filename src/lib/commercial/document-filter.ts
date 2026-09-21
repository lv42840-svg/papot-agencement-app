import type { CommercialDocument, CommercialDocumentCategory } from "./domain";

export type CommercialDocumentFilter = "ALL" | CommercialDocumentCategory;

export function filterCommercialDocuments(
  documents: readonly CommercialDocument[],
  filter: CommercialDocumentFilter,
): CommercialDocument[] {
  if (filter === "ALL") return [...documents];
  return documents.filter((document) => document.category === filter);
}
