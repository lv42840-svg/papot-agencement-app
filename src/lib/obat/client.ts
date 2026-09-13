import type { ObatImportAnalysis } from "./domain";

export const OBAT_ERROR_MESSAGES: Record<string, string> = {
  OBAT_FILES_REQUIRED: "Dépose au moins un devis PDF ou un bordereau CSV OBAT.",
  OBAT_TOO_MANY_FILES: "Analyse au maximum 8 fichiers OBAT à la fois.",
  OBAT_FILE_TOO_LARGE: "Un fichier est trop volumineux pour l'analyse OBAT (25 Mo maximum).",
  OBAT_DOCUMENT_NUMBER_MISMATCH: "Les documents ne portent pas le même numéro de devis OBAT.",
  OBAT_NOT_RECOGNIZED: "PAPOT n'a reconnu ni devis OBAT ni bordereau OBAT dans ces fichiers.",
  OBAT_PDF_UNSUPPORTED: "Ce PDF n'est pas lisible automatiquement. Il s'agit peut-être d'un scan.",
};

export async function requestObatAnalysis(files: File[]): Promise<ObatImportAnalysis> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const response = await fetch("/api/desktop/obat/analyze", { method: "POST", body: form });
  const body = (await response.json()) as { analysis?: ObatImportAnalysis; error?: string };
  if (!response.ok || !body.analysis) {
    const code = body.error ?? "OBAT_ANALYSIS_FAILED";
    throw new Error(OBAT_ERROR_MESSAGES[code] ?? "L'analyse des documents OBAT a échoué.");
  }
  return body.analysis;
}

export function obatKindForFile(
  file: File,
  analysis: ObatImportAnalysis,
): "QUOTE" | "COSTING" | "UNKNOWN" {
  return (
    analysis.files.find(
      (candidate) => candidate.name === file.name && candidate.sizeBytes === file.size,
    )?.kind ?? "UNKNOWN"
  );
}
