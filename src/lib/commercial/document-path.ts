import type { CommercialDocumentCategory } from "./domain";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const COMMERCIAL_DOCUMENT_FOLDER_NAMES: Record<CommercialDocumentCategory, string> = {
  RECEIVED: "Documents reçus",
  INTERNAL_QUOTING: "Chiffrage interne",
  QUOTE: "Devis",
  COSTING: "Déboursé",
  MISC: "Divers",
};

function cleanSegment(valeur: string, valeurSecours: string, longueurMaximale: number): string {
  const normalise = valeur
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  const tronque = (normalise || valeurSecours).slice(0, longueurMaximale).replace(/[. ]+$/g, "");
  if (WINDOWS_RESERVED_NAME.test(tronque)) {
    return `_${tronque}`;
  }
  return tronque || valeurSecours;
}

export function commercialAffairFolderName(nomClient: string | null, nomAffaire: string): string {
  const client = cleanSegment(nomClient ?? "", "Client à préciser", 90);
  const affaire = cleanSegment(nomAffaire, "Affaire", 90);
  return cleanSegment(`${client}_${affaire}`, "Affaire", 180);
}

export function commercialDocumentFolderName(categorie: CommercialDocumentCategory): string {
  return COMMERCIAL_DOCUMENT_FOLDER_NAMES[categorie];
}

export function commercialDocumentFileName(nomFichier: string): string {
  return cleanSegment(nomFichier, "document", 180);
}

export function commercialDocumentStoragePath(saisie: {
  creationYear: number;
  clientName: string | null;
  caseName: string;
  category: CommercialDocumentCategory;
  fileName: string;
}): string {
  if (
    !Number.isInteger(saisie.creationYear) ||
    saisie.creationYear < 2000 ||
    saisie.creationYear > 9999
  ) {
    throw new Error("COMMERCIAL_DOCUMENT_YEAR_INVALID");
  }

  return [
    "Commercial",
    String(saisie.creationYear),
    commercialAffairFolderName(saisie.clientName, saisie.caseName),
    commercialDocumentFolderName(saisie.category),
    commercialDocumentFileName(saisie.fileName),
  ].join("/");
}
