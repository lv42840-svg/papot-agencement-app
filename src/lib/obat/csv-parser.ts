import type { ObatImportAnalysis, ObatQuoteLine } from "./domain";

export type PartialObatData = Partial<
  Omit<ObatImportAnalysis, "hours" | "sources" | "files" | "warnings">
> & {
  hours?: Partial<ObatImportAnalysis["hours"]>;
};

function cleanLine(value: string): string {
  return value.replace(/[\t ]+/g, " ").trim();
}

function parseFrenchNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value
    .replace(/[€%]/g, "")
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(",", ".")
    .trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseCsvRows(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }

  if (cell || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function afterPrefix(value: string, prefix: RegExp): string | null {
  const match = value.match(prefix);
  return match?.[1]?.trim() || null;
}

function normalizeDesignation(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function parseObatCostingCsvText(rawText: string): PartialObatData {
  const rows = parseCsvRows(rawText);
  let quoteNumber: string | null = null;
  let quoteDate: string | null = null;
  let validUntil: string | null = null;
  let clientName: string | null = null;
  let clientAddress: string | null = null;
  let projectName: string | null = null;
  let siteAddress: string | null = null;
  let description: string | null = null;
  let be: number | null = null;
  let workshop: number | null = null;
  let install: number | null = null;
  const quoteLines: ObatQuoteLine[] = [];

  for (const row of rows) {
    const first = cleanLine(row[0] ?? "");
    const designation = normalizeDesignation(first);
    const quantity = parseFrenchNumber(row[1]);
    const unit = cleanLine(row[2] ?? "").toLowerCase();

    if (unit === "h" && quantity !== null) {
      if (designation === "ETUDES") be = quantity;
      if (designation === "FABRICATION") workshop = quantity;
      if (designation === "POSE") install = quantity;
    }

    const quotedLine = first.match(/^(\d{1,3}(?:\.\d+)*)\s+(.+)$/);
    if (quotedLine) {
      quoteLines.push({
        ref: quotedLine[1],
        designation: cleanLine(quotedLine[2]),
        quantity,
        unit: unit || null,
        totalHt: parseFrenchNumber(row[7]),
      });
    }

    quoteNumber ??= afterPrefix(first, /Bordereau de chantier sur devis\s*:\s*(D\d{6,})/i)?.toUpperCase() ?? null;
    quoteDate ??= dateToIso(afterPrefix(first, /En date du\s*:\s*(\d{2}\/\d{2}\/\d{4})/i));
    validUntil ??= dateToIso(afterPrefix(first, /Valable jusqu['’]?au\s*:\s*(\d{2}\/\d{2}\/\d{4})/i));

    const csvClient = afterPrefix(first, /Client\s*:\s*(.+)$/i);
    if (!clientName && csvClient) {
      clientName = csvClient.replace(/^(Mme|Mlle|M\.?|Mr|Monsieur|Madame)\s+/i, "").trim();
    }
    clientAddress ??= afterPrefix(first, /Adresse\s*:\s*(.+)$/i);
    projectName ??= afterPrefix(first, /Chantier\s*:\s*(.+)$/i);
    siteAddress ??= afterPrefix(first, /Adresse chantier\s*:\s*(.+)$/i);
    description ??= afterPrefix(first, /Description\s*:\s*(.+)$/i);
  }

  return {
    quoteNumber,
    quoteDate,
    validUntil,
    projectName,
    clientName,
    clientAddress,
    siteAddress,
    description: description ?? projectName,
    quoteLines,
    hours: { be, workshop, install },
  };
}
