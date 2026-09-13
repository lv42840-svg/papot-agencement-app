export type ObatFileKind = "QUOTE" | "COSTING" | "UNKNOWN";

export type ObatAnalyzedFile = {
  name: string;
  sizeBytes: number;
  kind: ObatFileKind;
  quoteNumber: string | null;
};

export type ObatImportAnalysis = {
  quoteNumber: string | null;
  quoteDate: string | null;
  validUntil: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  estimatedDuration: string | null;
  projectName: string | null;
  clientName: string | null;
  clientAddress: string | null;
  clientSiren: string | null;
  contactName: string | null;
  siteAddress: string | null;
  description: string | null;
  totalNetHt: number | null;
  vatAmount: number | null;
  totalTtc: number | null;
  depositTtc: number | null;
  hours: {
    be: number | null;
    workshop: number | null;
    install: number | null;
  };
  sources: {
    quotePdf: boolean;
    costingCsv: boolean;
  };
  files: ObatAnalyzedFile[];
  warnings: string[];
};

export function emptyObatImportAnalysis(): ObatImportAnalysis {
  return {
    quoteNumber: null,
    quoteDate: null,
    validUntil: null,
    plannedStartDate: null,
    plannedEndDate: null,
    estimatedDuration: null,
    projectName: null,
    clientName: null,
    clientAddress: null,
    clientSiren: null,
    contactName: null,
    siteAddress: null,
    description: null,
    totalNetHt: null,
    vatAmount: null,
    totalTtc: null,
    depositTtc: null,
    hours: { be: null, workshop: null, install: null },
    sources: { quotePdf: false, costingCsv: false },
    files: [],
    warnings: [],
  };
}
