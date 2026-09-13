import { inflateSync } from "node:zlib";
import type { PartialObatData } from "./csv-parser";

type PdfObjectMap = Map<number, string>;
type FontMap = Map<number, string>;

function dateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
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

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function cleanLine(value: string): string {
  return value.replace(/[\t ]+/g, " ").trim();
}

function normalizeAddress(parts: string[]): string | null {
  const cleaned = parts.map(cleanLine).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(", ").replace(/(\b\d{5}),\s+/g, "$1 ");
}

function parseClientBlock(lines: string[]): {
  clientName: string | null;
  contactName: string | null;
  clientAddress: string | null;
  clientSiren: string | null;
} {
  const sirenIndex = lines.findIndex((line) => /\bSIREN\s*:/i.test(line));
  if (sirenIndex < 0) {
    return { clientName: null, contactName: null, clientAddress: null, clientSiren: null };
  }

  const clientSiren = firstMatch(lines[sirenIndex], /SIREN\s*:\s*([0-9 ]{9,20})/i)?.replace(/\s/g, "") ?? null;
  let addressIndex = -1;
  for (let index = sirenIndex - 1; index >= Math.max(0, sirenIndex - 10); index -= 1) {
    if (/^\d{1,5}\s+\S/.test(lines[index])) {
      addressIndex = index;
      break;
    }
  }

  if (addressIndex < 0) {
    return { clientName: null, contactName: null, clientAddress: null, clientSiren };
  }

  let honorificIndex = -1;
  for (let index = addressIndex - 1; index >= Math.max(0, addressIndex - 7); index -= 1) {
    if (/^(Mme|Mlle|M\.?|Mr|Monsieur|Madame)\b/i.test(lines[index])) {
      honorificIndex = index;
      break;
    }
  }

  const clientName =
    honorificIndex > 0
      ? lines[honorificIndex - 1]
      : addressIndex > 0
        ? lines[addressIndex - 1]
        : null;
  const contactName = honorificIndex >= 0 ? lines.slice(honorificIndex, addressIndex).join(" ") : null;
  const clientAddress = normalizeAddress(lines.slice(addressIndex, sirenIndex));

  return {
    clientName: clientName ? cleanLine(clientName) : null,
    contactName: contactName ? cleanLine(contactName) : null,
    clientAddress,
    clientSiren,
  };
}

function extractMoney(flatText: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return parseFrenchNumber(
    firstMatch(flatText, new RegExp(`${escaped}\\s*([0-9][0-9\\s.,]*)\\s*€`, "i")),
  );
}

export function parseObatQuoteText(rawText: string): PartialObatData {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
  const flat = lines.join(" ").replace(/\s+/g, " ").trim();

  const quoteNumber = firstMatch(flat, /\b(D\d{6,})\b/i)?.toUpperCase() ?? null;
  const quoteDate = dateToIso(firstMatch(flat, /En date du\s*:\s*(\d{2}\/\d{2}\/\d{4})/i));
  const validUntil = dateToIso(
    firstMatch(flat, /Valable jusqu['’]?\s*au\s*:\s*(\d{2}\/\d{2}\/\d{4})/i),
  );
  const plannedStartDate = dateToIso(
    firstMatch(flat, /Début des travaux le\s*:\s*(\d{2}\/\d{2}\/\d{4})/i),
  );
  const plannedEndDate = dateToIso(
    firstMatch(flat, /Date limite de fin de chantier le\s*:\s*(\d{2}\/\d{2}\/\d{4})/i),
  );
  const estimatedDuration = firstMatch(
    flat,
    /Durée estimée à\s*:\s*(.+?)\s+Date limite de fin de chantier/i,
  );

  let projectName: string | null = null;
  const endDateLineIndex = lines.findIndex((line) => /Date limite de fin de chantier le\s*:/i.test(line));
  if (endDateLineIndex >= 0) {
    const candidate = lines[endDateLineIndex + 1];
    if (candidate && !/^N[°º]?$/i.test(candidate) && !/D[ÉE]SIGNATION/i.test(candidate)) {
      projectName = candidate;
    }
  }
  if (!projectName) {
    projectName = firstMatch(
      flat,
      /Date limite de fin de chantier le\s*:\s*\d{2}\/\d{2}\/\d{4}\s+(.+?)\s+N[°º]?\s+D[ÉE]SIGNATION/i,
    );
  }

  const client = parseClientBlock(lines);
  const vatAmount = firstMatch(flat, /TVA\s+[0-9.,]+\s*%\s*([0-9][0-9\s.,]*)\s*€/i);
  const depositTtc = firstMatch(
    flat,
    /Acompte de\s+[0-9.,]+\s*%.*?soit\s*([0-9][0-9\s.,]*)\s*€\s*TTC/i,
  );

  return {
    quoteNumber,
    quoteDate,
    validUntil,
    plannedStartDate,
    plannedEndDate,
    estimatedDuration,
    projectName,
    clientName: client.clientName,
    clientAddress: client.clientAddress,
    clientSiren: client.clientSiren,
    contactName: client.contactName,
    siteAddress: client.clientAddress,
    description: projectName,
    totalNetHt: extractMoney(flat, "Total net HT"),
    vatAmount: parseFrenchNumber(vatAmount),
    totalTtc: extractMoney(flat, "Total TTC"),
    depositTtc: parseFrenchNumber(depositTtc),
  };
}

function parseObjects(buffer: Buffer): PdfObjectMap {
  const source = buffer.toString("latin1");
  const objects: PdfObjectMap = new Map();
  const regex = /(?:^|\n)(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    objects.set(Number(match[1]), match[2]);
  }
  return objects;
}

function extractStream(objectBody: string): Buffer | null {
  const marker = /stream\r?\n/.exec(objectBody);
  if (!marker || marker.index === undefined) return null;
  const start = marker.index + marker[0].length;
  const end = objectBody.indexOf("endstream", start);
  if (end < 0) return null;
  let raw = objectBody.slice(start, end);
  if (raw.endsWith("\r\n")) raw = raw.slice(0, -2);
  else if (raw.endsWith("\n")) raw = raw.slice(0, -1);
  const bytes = Buffer.from(raw, "latin1");
  if (!objectBody.slice(0, marker.index).includes("/FlateDecode")) return bytes;
  try {
    return inflateSync(bytes);
  } catch {
    return null;
  }
}

function utf16BeHexToString(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  let result = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    result += String.fromCharCode(bytes.readUInt16BE(index));
  }
  return result;
}

function parseToUnicodeMap(cmap: Buffer): FontMap {
  const text = cmap.toString("latin1");
  const result: FontMap = new Map();
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  let block: RegExpExecArray | null;

  while ((block = bfchar.exec(text)) !== null) {
    const entries = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let entry: RegExpExecArray | null;
    while ((entry = entries.exec(block[1])) !== null) {
      result.set(Number.parseInt(entry[1], 16), utf16BeHexToString(entry[2]));
    }
  }

  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrange.exec(text)) !== null) {
    for (const rawLine of block[1].split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const arrayRange = line.match(
        /^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]$/,
      );
      if (arrayRange) {
        const start = Number.parseInt(arrayRange[1], 16);
        const end = Number.parseInt(arrayRange[2], 16);
        const values = [...arrayRange[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((entry) => entry[1]);
        for (let source = start; source <= end; source += 1) {
          const value = values[source - start];
          if (value) result.set(source, utf16BeHexToString(value));
        }
        continue;
      }

      const sequentialRange = line.match(
        /^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>$/,
      );
      if (sequentialRange) {
        const start = Number.parseInt(sequentialRange[1], 16);
        const end = Number.parseInt(sequentialRange[2], 16);
        const target = Number.parseInt(sequentialRange[3], 16);
        for (let source = start; source <= end; source += 1) {
          result.set(source, String.fromCodePoint(target + source - start));
        }
      }
    }
  }

  return result;
}

function resourceRefs(objectBody: string, key: "Font" | "XObject"): Map<string, number> {
  const match = new RegExp(`/${key}\\s*<<([\\s\\S]*?)>>`).exec(objectBody);
  const result = new Map<string, number>();
  if (!match) return result;
  const references = /\/([A-Za-z0-9._-]+)\s+(\d+)\s+0\s+R/g;
  let reference: RegExpExecArray | null;
  while ((reference = references.exec(match[1])) !== null) {
    result.set(reference[1], Number(reference[2]));
  }
  return result;
}

function decodeHexText(hex: string, fontMap: FontMap | undefined): string {
  if (!fontMap) return "";
  const bytes = Buffer.from(hex, "hex");
  let result = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    result += fontMap.get(bytes.readUInt16BE(index)) ?? "";
  }
  return result;
}

function extractTextFromContent(
  content: Buffer,
  fontRefs: Map<string, number>,
  fontMaps: Map<number, FontMap>,
): string {
  const source = content.toString("latin1");
  const output: string[] = [];
  let currentFont: string | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const font = line.match(/\/([A-Za-z0-9._-]+)\s+[-+]?\d+(?:\.\d+)?\s+Tf/);
    if (font) currentFont = font[1];
    const fontMap = currentFont ? fontMaps.get(fontRefs.get(currentFont) ?? -1) : undefined;

    const shownHex = /<([0-9A-Fa-f]+)>\s*Tj/g;
    let shown: RegExpExecArray | null;
    while ((shown = shownHex.exec(line)) !== null) output.push(decodeHexText(shown[1], fontMap));

    const arrays = /\[([\s\S]*?)\]\s*TJ/g;
    let array: RegExpExecArray | null;
    while ((array = arrays.exec(line)) !== null) {
      for (const entry of array[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
        output.push(decodeHexText(entry[1], fontMap));
      }
    }

    if (/\bET\b/.test(line)) output.push("\n");
  }

  return output.join("");
}

function extractFormText(
  objectId: number,
  objects: PdfObjectMap,
  fontMaps: Map<number, FontMap>,
  visited: Set<number>,
): string {
  if (visited.has(objectId)) return "";
  visited.add(objectId);
  const objectBody = objects.get(objectId);
  if (!objectBody) return "";
  const stream = extractStream(objectBody);
  if (!stream) return "";
  const resourceMatch = objectBody.match(/\/Resources\s+(\d+)\s+0\s+R/);
  const resources = resourceMatch ? objects.get(Number(resourceMatch[1])) ?? "" : objectBody;
  const fonts = resourceRefs(resources, "Font");
  const xObjects = resourceRefs(resources, "XObject");
  let result = extractTextFromContent(stream, fonts, fontMaps);
  const streamText = stream.toString("latin1");
  for (const invocation of streamText.matchAll(/\/([A-Za-z0-9._-]+)\s+Do/g)) {
    const nestedId = xObjects.get(invocation[1]);
    if (nestedId) result += extractFormText(nestedId, objects, fontMaps, visited);
  }
  return result;
}

export function extractPdfText(buffer: Buffer): string {
  const objects = parseObjects(buffer);
  if (objects.size === 0) throw new Error("OBAT_PDF_UNSUPPORTED");

  const fontMaps = new Map<number, FontMap>();
  for (const [objectId, objectBody] of objects) {
    if (!/\/Type\s*\/Font\b/.test(objectBody)) continue;
    const unicodeReference = objectBody.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!unicodeReference) continue;
    const cmapObject = objects.get(Number(unicodeReference[1]));
    const cmapStream = cmapObject ? extractStream(cmapObject) : null;
    if (cmapStream) fontMaps.set(objectId, parseToUnicodeMap(cmapStream));
  }

  const pages = [...objects.entries()]
    .filter(([, objectBody]) => /\/Type\s*\/Page\b/.test(objectBody))
    .sort(([left], [right]) => left - right);
  const pageTexts: string[] = [];

  for (const [, page] of pages) {
    const resourceReference = page.match(/\/Resources\s+(\d+)\s+0\s+R/);
    const contentReference = page.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (!contentReference) continue;
    const resources = resourceReference ? objects.get(Number(resourceReference[1])) ?? "" : page;
    const fonts = resourceRefs(resources, "Font");
    const xObjects = resourceRefs(resources, "XObject");
    const contentObject = objects.get(Number(contentReference[1]));
    const content = contentObject ? extractStream(contentObject) : null;
    if (!content) continue;

    let pageText = extractTextFromContent(content, fonts, fontMaps);
    const contentText = content.toString("latin1");
    for (const invocation of contentText.matchAll(/\/([A-Za-z0-9._-]+)\s+Do/g)) {
      const formId = xObjects.get(invocation[1]);
      if (formId) pageText += extractFormText(formId, objects, fontMaps, new Set());
    }
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n");
}
