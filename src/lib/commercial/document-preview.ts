import type { CommercialDocument } from "./domain";

export const COMMERCIAL_DOCUMENT_PREVIEW_MIN_HEIGHT = 220;
export const COMMERCIAL_DOCUMENT_PREVIEW_MAX_HEIGHT = 900;
export const COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT = 460;

export function canPreviewCommercialDocument(
  document: Pick<CommercialDocument, "contentType">,
): boolean {
  return document.contentType === "application/pdf" || document.contentType.startsWith("image/");
}

export function clampCommercialDocumentPreviewHeight(value: number): number {
  if (!Number.isFinite(value)) return COMMERCIAL_DOCUMENT_PREVIEW_DEFAULT_HEIGHT;
  return Math.min(
    COMMERCIAL_DOCUMENT_PREVIEW_MAX_HEIGHT,
    Math.max(COMMERCIAL_DOCUMENT_PREVIEW_MIN_HEIGHT, Math.round(value)),
  );
}
