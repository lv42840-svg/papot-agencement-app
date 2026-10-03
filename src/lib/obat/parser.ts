import { emptyObatImportAnalysis, type ObatAnalyzedFile, type ObatImportAnalysis } from "./domain";
import { parseObatCostingCsvText, type PartialObatData } from "./csv-parser";
import { extractPdfText, parseObatQuoteText } from "./pdf-parser";

const MAX_ANALYZED_FILES = 8;
const MAX_ANALYZED_FILE_SIZE = 25 * 1024 * 1024;

function mergeValue<T>(current: T | null, incoming: T | null | undefined): T | null {
  return current ?? incoming ?? null;
}

function mergeData(
  target: ObatImportAnalysis,
  incoming: PartialObatData,
  preferIncoming = false,
): void {
  const keys: Array<
    keyof Omit<ObatImportAnalysis, "quoteLines" | "hours" | "sources" | "files" | "warnings">
  > = [
    "quoteNumber",
    "quoteDate",
    "validUntil",
    "plannedStartDate",
    "plannedEndDate",
    "estimatedDuration",
    "projectName",
    "clientName",
    "clientAddress",
    "clientSiren",
    "contactName",
    "siteAddress",
    "description",
    "totalNetHt",
    "vatAmount",
    "totalTtc",
    "depositTtc",
  ];

  for (const key of keys) {
    const incomingValue = incoming[key];
    if (incomingValue === undefined || incomingValue === null || incomingValue === "") continue;
    if (preferIncoming || target[key] === null) {
      (target as unknown as Record<string, unknown>)[key] = incomingValue;
    }
  }

  if (incoming.quoteLines?.length && (preferIncoming || target.quoteLines.length === 0)) {
    target.quoteLines = incoming.quoteLines;
  }

  if (incoming.hours) {
    target.hours.be = mergeValue(target.hours.be, incoming.hours.be ?? null);
    target.hours.workshop = mergeValue(target.hours.workshop, incoming.hours.workshop ?? null);
    target.hours.install = mergeValue(target.hours.install, incoming.hours.install ?? null);
  }
}

function extensionOf(file: File): string {
  return file.name.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] ?? "";
}

export async function analyzeObatFiles(files: File[]): Promise<ObatImportAnalysis> {
  if (files.length === 0) throw new Error("OBAT_FILES_REQUIRED");
  if (files.length > MAX_ANALYZED_FILES) throw new Error("OBAT_TOO_MANY_FILES");
  if (files.some((file) => file.size > MAX_ANALYZED_FILE_SIZE))
    throw new Error("OBAT_FILE_TOO_LARGE");

  const result = emptyObatImportAnalysis();
  const quoteNumbers = new Set<string>();

  for (const file of files) {
    const extension = extensionOf(file);
    let kind: ObatAnalyzedFile["kind"] = "UNKNOWN";
    let quoteNumber: string | null = null;

    if (file.type === "application/pdf" || extension === ".pdf") {
      const text = extractPdfText(Buffer.from(await file.arrayBuffer()));
      const parsed = parseObatQuoteText(text);
      quoteNumber = parsed.quoteNumber ?? null;
      if (quoteNumber) {
        kind = "QUOTE";
        result.sources.quotePdf = true;
        quoteNumbers.add(quoteNumber);
        mergeData(result, parsed, true);
      } else {
        result.warnings.push(`${file.name} : aucun devis OBAT lisible n'a été reconnu.`);
      }
    } else if (file.type === "text/csv" || extension === ".csv") {
      const parsed = parseObatCostingCsvText(await file.text());
      quoteNumber = parsed.quoteNumber ?? null;
      if (quoteNumber) {
        kind = "COSTING";
        result.sources.costingCsv = true;
        quoteNumbers.add(quoteNumber);
        mergeData(result, parsed, true);
      } else {
        result.warnings.push(`${file.name} : aucun bordereau OBAT lisible n'a été reconnu.`);
      }
    } else {
      result.warnings.push(
        `${file.name} : format non analysé. Utilise un PDF de devis ou un CSV de bordereau OBAT.`,
      );
    }

    result.files.push({ name: file.name, sizeBytes: file.size, kind, quoteNumber });
  }

  if (quoteNumbers.size > 1) throw new Error("OBAT_DOCUMENT_NUMBER_MISMATCH");
  result.quoteNumber = result.quoteNumber ?? [...quoteNumbers][0] ?? null;
  if (!result.sources.quotePdf && !result.sources.costingCsv)
    throw new Error("OBAT_NOT_RECOGNIZED");

  if (
    result.sources.costingCsv &&
    result.hours.be === null &&
    result.hours.workshop === null &&
    result.hours.install === null
  ) {
    result.warnings.push(
      "Le bordereau a été reconnu mais aucune ligne ÉTUDES / FABRICATION / POSE en heures n'a été trouvée.",
    );
  }

  return result;
}
