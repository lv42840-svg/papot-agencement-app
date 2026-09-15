import type { CommercialDocumentCategory } from "./domain";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const COMMERCIAL_DOCUMENT_FOLDER_NAMES: Record<CommercialDocumentCategory, string> = {
  RECEIVED: "Documents reçus",
  INTERNAL_QUOTING: "Chiffrage interne",
  QUOTE: "Devis",
  COSTING: "Déboursé",
  MISC: "Divers",
};

function cleanSegment(value: string, fallback: string, maxLength: number): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  const clipped = (normalized || fallback).slice(0, maxLength).replace(/[. ]+$/g, "");
  if (WINDOWS_RESERVED_NAME.test(clipped)) return `_${clipped}`;
  return clipped || fallback;
}

export function commercialAffairFolderName(clientName: string | null, caseName: string): string {
  const client = cleanSegment(clientName ?? "", "Client à préciser", 90);
  const affair = cleanSegment(caseName, "Affaire", 90);
  return cleanSegment(`${client}_${affair}`, "Affaire", 180);
}

export function commercialDocumentFolderName(category: CommercialDocumentCategory): string {
  return COMMERCIAL_DOCUMENT_FOLDER_NAMES[category];
}

export function commercialDocumentFileName(fileName: string): string {
  return cleanSegment(fileName, "document", 180);
}

export function commercialDocumentStoragePath(input: {
  creationYear: number;
  clientName: string | null;
  caseName: string;
  category: CommercialDocumentCategory;
  fileName: string;
}): string {
  if (!Number.isInteger(input.creationYear) || input.creationYear < 2000 || input.creationYear > 9999) {
    throw new Error("COMMERCIAL_DOCUMENT_YEAR_INVALID");
  }

  return [
    "documents",
    "commercial",
    String(input.creationYear),
    commercialAffairFolderName(input.clientName, input.caseName),
    commercialDocumentFolderName(input.category),
    commercialDocumentFileName(input.fileName),
  ].join("/");
}
