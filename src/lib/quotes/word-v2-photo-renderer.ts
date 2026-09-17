import { createHash } from "node:crypto";
import {
  cloneZipEntryWithData,
  readZipArchive,
  writeZipArchive,
  type ZipArchiveEntry,
} from "../documents/zip-archive";
import type { QuoteDocumentData, QuoteDocumentItem } from "./document-data";
import type { QuoteItemPhoto } from "./model";

const ANNEX_ANCHOR = "{{PAPOT_ANNEX_IMAGES}}";
const IMAGE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const EMU_PER_INCH = 914400;
const MAX_IMAGE_WIDTH_EMU = Math.round(5.8 * EMU_PER_INCH);
const MAX_IMAGE_HEIGHT_EMU = Math.round(3.25 * EMU_PER_INCH);

export type QuoteWordV2PhotoLoader = (photo: QuoteItemPhoto) => Promise<Uint8Array>;

type LoadedPhoto = {
  item: QuoteDocumentItem;
  photo: QuoteItemPhoto;
  bytes: Uint8Array;
  width: number;
  height: number;
  extension: "jpg" | "png" | "webp";
  relationshipId: string;
  mediaName: string;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertPhotoBytes(photo: QuoteItemPhoto, bytes: Uint8Array): void {
  if (bytes.byteLength !== photo.sizeBytes) {
    throw new Error(`QUOTE_WORD_V2_PHOTO_SIZE_MISMATCH:${photo.id}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== photo.sha256) {
    throw new Error(`QUOTE_WORD_V2_PHOTO_SHA256_MISMATCH:${photo.id}`);
  }

  const buffer = Buffer.from(bytes);
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  const matches =
    (photo.contentType === "image/png" && isPng) ||
    (photo.contentType === "image/jpeg" && isJpeg) ||
    (photo.contentType === "image/webp" && isWebp);
  if (!matches) throw new Error(`QUOTE_WORD_V2_PHOTO_MIME_MISMATCH:${photo.id}`);
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && length >= 7) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 >> 6) | (b3 & 0xf0) << 2 | b0 * 0);
    if (width > 0 && height > 0) return { width, height };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    const frame = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (frame >= 0 && frame + 7 <= buffer.length) {
      return {
        width: buffer.readUInt16LE(frame + 3) & 0x3fff,
        height: buffer.readUInt16LE(frame + 5) & 0x3fff,
      };
    }
  }
  return null;
}

function imageDimensions(photo: QuoteItemPhoto, bytes: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(bytes);
  const dimensions =
    photo.contentType === "image/png"
      ? pngDimensions(buffer)
      : photo.contentType === "image/jpeg"
        ? jpegDimensions(buffer)
        : webpDimensions(buffer);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error(`QUOTE_WORD_V2_PHOTO_DIMENSIONS_INVALID:${photo.id}`);
  }
  return dimensions;
}

function extensionFor(photo: QuoteItemPhoto): "jpg" | "png" | "webp" {
  if (photo.contentType === "image/jpeg") return "jpg";
  if (photo.contentType === "image/png") return "png";
  return "webp";
}

function scaledExtent(width: number, height: number): { cx: number; cy: number } {
  const scale = Math.min(MAX_IMAGE_WIDTH_EMU / width, MAX_IMAGE_HEIGHT_EMU / height);
  return {
    cx: Math.max(1, Math.round(width * scale)),
    cy: Math.max(1, Math.round(height * scale)),
  };
}

function imageParagraph(photo: LoadedPhoto, docPrId: number): string {
  const { cx, cy } = scaledExtent(photo.width, photo.height);
  const name = escapeXml(`Photo devis ${photo.item.number || photo.item.id}`);
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(photo.photo.fileName)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${photo.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function captionParagraph(item: QuoteDocumentItem): string {
  const label = [item.number, item.text].filter(Boolean).join(" - ");
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}</w:t></w:r></w:p>`;
}

function annexXml(photos: LoadedPhoto[]): string {
  const parts = [
    '<w:p><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>PHOTOS CLIENT</w:t></w:r></w:p>',
  ];
  photos.forEach((photo, index) => {
    parts.push(imageParagraph(photo, 10000 + index), captionParagraph(photo.item));
  });
  return parts.join("");
}

function replaceAnchorParagraph(documentXml: string, replacement: string): string {
  const anchorIndex = documentXml.indexOf(ANNEX_ANCHOR);
  if (anchorIndex < 0) throw new Error("QUOTE_WORD_V2_ANNEX_ANCHOR_MISSING");
  if (documentXml.indexOf(ANNEX_ANCHOR, anchorIndex + ANNEX_ANCHOR.length) >= 0) {
    throw new Error("QUOTE_WORD_V2_ANNEX_ANCHOR_DUPLICATE");
  }
  const paragraphStart = documentXml.lastIndexOf("<w:p", anchorIndex);
  const paragraphEndStart = documentXml.indexOf("</w:p>", anchorIndex);
  if (paragraphStart < 0 || paragraphEndStart < 0) {
    throw new Error("QUOTE_WORD_V2_ANNEX_PARAGRAPH_MISSING");
  }
  const paragraphEnd = paragraphEndStart + "</w:p>".length;
  return `${documentXml.slice(0, paragraphStart)}${replacement}${documentXml.slice(paragraphEnd)}`;
}

function nextRelationshipId(relsXml: string): number {
  let max = 0;
  for (const match of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function appendRelationships(relsXml: string, photos: LoadedPhoto[]): string {
  const closeIndex = relsXml.lastIndexOf("</Relationships>");
  if (closeIndex < 0) throw new Error("QUOTE_WORD_V2_DOCUMENT_RELS_INVALID");
  const relationships = photos
    .map(
      (photo) =>
        `<Relationship Id="${photo.relationshipId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="media/${photo.mediaName}"/>`,
    )
    .join("");
  return `${relsXml.slice(0, closeIndex)}${relationships}${relsXml.slice(closeIndex)}`;
}

function ensureContentTypes(xml: string, photos: LoadedPhoto[]): string {
  const needed = new Map<string, string>();
  for (const photo of photos) needed.set(photo.extension, photo.photo.contentType);
  let next = xml;
  for (const [extension, contentType] of needed) {
    const exists = new RegExp(`<Default\\b[^>]*\\bExtension="${extension}"`, "i").test(next);
    if (exists) continue;
    const closeIndex = next.lastIndexOf("</Types>");
    if (closeIndex < 0) throw new Error("QUOTE_WORD_V2_CONTENT_TYPES_INVALID");
    next = `${next.slice(0, closeIndex)}<Default Extension="${extension}" ContentType="${contentType}"/>${next.slice(closeIndex)}`;
  }
  return next;
}

function mediaEntry(template: ZipArchiveEntry, name: string, data: Uint8Array): ZipArchiveEntry {
  return {
    ...template,
    name,
    data,
    compressionMethod: 8,
    internalAttributes: 0,
    externalAttributes: 0,
  };
}

function visiblePhotos(document: QuoteDocumentData): Array<{ item: QuoteDocumentItem; photo: QuoteItemPhoto }> {
  const seen = new Set<string>();
  const result: Array<{ item: QuoteDocumentItem; photo: QuoteItemPhoto }> = [];
  for (const item of document.items) {
    if (item.scope === "REJECTED_OPTION") continue;
    for (const photo of item.clientPhotos) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      result.push({ item, photo });
    }
  }
  return result;
}

export async function renderQuoteWordV2Photos(
  docx: Uint8Array,
  document: QuoteDocumentData,
  loader: QuoteWordV2PhotoLoader,
): Promise<Uint8Array> {
  const candidates = visiblePhotos(document);
  if (candidates.length === 0) throw new Error("QUOTE_WORD_V2_PHOTOS_EMPTY");

  const entries = readZipArchive(docx);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
  const relsEntry = entries.find((entry) => entry.name === "word/_rels/document.xml.rels");
  const contentTypesEntry = entries.find((entry) => entry.name === "[Content_Types].xml");
  if (!documentEntry || !relsEntry || !contentTypesEntry) {
    throw new Error("QUOTE_WORD_V2_PHOTO_PACKAGE_PART_MISSING");
  }

  let relationshipNumber = nextRelationshipId(Buffer.from(relsEntry.data).toString("utf8"));
  const loaded: LoadedPhoto[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const bytes = await loader(candidate.photo);
    assertPhotoBytes(candidate.photo, bytes);
    const dimensions = imageDimensions(candidate.photo, bytes);
    const extension = extensionFor(candidate.photo);
    loaded.push({
      ...candidate,
      bytes,
      ...dimensions,
      extension,
      relationshipId: `rId${relationshipNumber++}`,
      mediaName: `papot-quote-photo-${index + 1}.${extension}`,
    });
  }

  const nextDocumentXml = replaceAnchorParagraph(
    Buffer.from(documentEntry.data).toString("utf8"),
    annexXml(loaded),
  );
  const nextRelsXml = appendRelationships(Buffer.from(relsEntry.data).toString("utf8"), loaded);
  const nextContentTypes = ensureContentTypes(
    Buffer.from(contentTypesEntry.data).toString("utf8"),
    loaded,
  );

  const nextEntries = entries.map((entry) => {
    if (entry.name === documentEntry.name) {
      return cloneZipEntryWithData(entry, Buffer.from(nextDocumentXml, "utf8"));
    }
    if (entry.name === relsEntry.name) {
      return cloneZipEntryWithData(entry, Buffer.from(nextRelsXml, "utf8"));
    }
    if (entry.name === contentTypesEntry.name) {
      return cloneZipEntryWithData(entry, Buffer.from(nextContentTypes, "utf8"));
    }
    return entry;
  });
  nextEntries.push(
    ...loaded.map((photo) => mediaEntry(documentEntry, `word/media/${photo.mediaName}`, photo.bytes)),
  );
  return writeZipArchive(nextEntries);
}
