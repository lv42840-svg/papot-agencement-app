import type { CommercialDocument } from "./domain";

export function canPreviewCommercialDocument(
  document: Pick<CommercialDocument, "contentType">,
): boolean {
  return document.contentType === "application/pdf" || document.contentType.startsWith("image/");
}
