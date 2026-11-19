import type { BillingDraft, BillingVisaVersion } from "./domain";
import { lineHtCents } from "./document-lines";

/**
 * Dependency-free, paginated A4 PDF of an archived provisional presentation.
 * NEVER issues a legal invoice number, never transmits to Pennylane.
 * Only historical visa snapshots are rendered, never the current draft lines.
 */
const PAGE_HEIGHT = 842;
const PAGE_BOTTOM = 744;

function pdfEscape(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/€/g, "EUR")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[^\x20-\xFF]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
const quantity = (value: number) => String(value).replace(".", ",");

function wrapWords(value: string, width: number): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  const result: string[] = [];
  let row = "";
  for (const word of clean.split(" ")) {
    if (row && row.length + word.length + 1 > width) {
      result.push(row);
      row = "";
    }
    if (word.length > width) {
      if (row) {
        result.push(row);
        row = "";
      }
      for (let i = 0; i < word.length; i += width) result.push(word.slice(i, i + width));
    } else {
      row = row ? `${row} ${word}` : word;
    }
  }
  if (row) result.push(row);
  return result;
}

export type BillingVisaPdfIdentity = Pick<BillingDraft, "id">;

export function generateBillingVisaProvisionalPdf(
  visa: BillingVisaVersion,
  draft: BillingVisaPdfIdentity,
): Uint8Array {
  if (visa.draftId !== draft.id) throw new Error("BILLING_VISA_DRAFT_MISMATCH");

  const pages: string[][] = [];
  let commands: string[] = [];
  let cursor = 0;

  function raw(value: string) {
    commands.push(value);
  }
  function text(value: string, x: number, top: number, size = 9, bold = false) {
    raw(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${PAGE_HEIGHT - top} Td (${pdfEscape(value)}) Tj ET`,
    );
  }
  function line(y: number) {
    raw(`0.78 G 0.6 w 38 ${PAGE_HEIGHT - y} m 557 ${PAGE_HEIGHT - y} l S 0 G`);
  }
  function header() {
    raw("0.26 0.18 0.44 rg");
    text("PAPOT AGENCEMENT", 38, 42, 12, true);
    raw("0 g");
    text(`PRESENTATION PROVISOIRE - VERSION V${visa.version}`, 38, 75, 16, true);
    text("DOCUMENT DE VALIDATION - NON FACTURE / SANS NUMERO LEGAL", 38, 93, 9, true);
    line(105);

    text(`Client : ${visa.clientName}`.slice(0, 92), 38, 126, 9);
    text(`Chantier : ${visa.chantierName}`.slice(0, 92), 38, 142, 9);
    text(`Intitule : ${visa.documentLabel}`.slice(0, 92), 38, 158, 9);
    text(`Destinataire : ${visa.submittedTo}`.slice(0, 92), 38, 174, 9);
    text(`Presentation du ${new Date(visa.submittedAt).toLocaleDateString("fr-FR")}`, 38, 190, 9);
    line(203);
    raw("0.29 0.21 0.43 rg");
    text("Designation", 41, 222, 9, true);
    text("Qte", 311, 222, 9, true);
    text("Unite", 348, 222, 9, true);
    text("P.U. HT", 398, 222, 8, true);
    text("TVA", 464, 222, 9, true);
    text("Total HT", 512, 222, 8, true);
    raw("0 g");
    line(230);
    cursor = 245;
  }
  function addPage() {
    if (pages.length >= 200) throw new Error("BILLING_VISA_PDF_PAGE_LIMIT");
    commands = [];
    pages.push(commands);
    header();
  }
  addPage();

  for (const item of visa.documentLines) {
    const title = item.origin === "TITLE";
    const indent = title && item.headingLevel === "SUBSECTION" ? 14 : 0;
    const descriptionLines = wrapWords(item.description, title ? 44 : 31);
    const lineHeight = title ? 13 : 12;

    // A single 4,000-character line may span multiple A4 pages.
    // Split its description at a visible page boundary instead of drawing through the footer.
    let printed = 0;
    while (printed < descriptionLines.length) {
      const maximumLines = Math.floor((PAGE_BOTTOM - cursor - 12) / lineHeight);
      if (maximumLines < 1) {
        addPage();
        continue;
      }
      const count = Math.min(maximumLines, descriptionLines.length - printed);
      const height = Math.max(title ? 26 : 24, count * lineHeight + 10);
      if (cursor + height > PAGE_BOTTOM) {
        addPage();
        continue;
      }

      if (title) raw("0.28 0.20 0.45 rg");
      for (let i = 0; i < count; i++) {
        text(
          descriptionLines[printed + i],
          41 + (title ? indent : 0),
          cursor + 10 + i * lineHeight,
          title ? 9.5 : 8.5,
          title,
        );
      }
      if (title) raw("0 g");
      if (!title && printed === 0) {
        text(quantity(item.quantity), 311, cursor + 10, 8);
        text(item.unit, 348, cursor + 10, 8);
        text(euros(item.unitPriceCents), 395, cursor + 10, 7.5);
        text(`${item.vatRatePercent} %`, 464, cursor + 10, 8);
        text(euros(lineHtCents(item)), 500, cursor + 10, 7.0);
      }
      line(cursor + height - 4);
      cursor += height;
      printed += count;
      if (printed < descriptionLines.length) addPage();
    }
  }

  const noteLines = visa.documentNotes ? wrapWords(visa.documentNotes, 88) : [];
  const presentationLines = visa.submittedNotes ? wrapWords(visa.submittedNotes, 88) : [];

  function paragraph(caption: string, values: string[]) {
    if (!values.length) return;
    if (cursor + 28 > PAGE_BOTTOM) addPage();
    text(caption, 41, cursor + 13, 9, true);
    cursor += 24;
    for (const value of values.slice(0, 100)) {
      if (cursor + 17 > PAGE_BOTTOM) addPage();
      text(value, 41, cursor + 10, 9);
      cursor += 14;
    }
  }
  paragraph("Observations :", noteLines);
  paragraph("Note de presentation :", presentationLines);
  if (cursor + 95 > PAGE_BOTTOM) addPage();
  line(cursor + 6);
  text(`TOTAL HT : ${euros(visa.amountHtCents)}`, 380, cursor + 26, 10, true);
  text(`TVA : ${euros(visa.vatCents)}`, 380, cursor + 46, 10);
  text(`TOTAL TTC : ${euros(visa.totalTtcCents)}`, 380, cursor + 68, 11, true);

  for (const [index, sheet] of pages.entries()) {
    sheet.push(`0.72 G 0.6 w 38 64 m 557 64 l S 0 G`);
    sheet.push(
      `BT /F2 8 Tf 38 48 Td (${pdfEscape("PROVISOIRE - NON FACTURE - AUCUN ENVOI PENNYLANE")}) Tj ET`,
    );
    sheet.push(`BT /F1 8 Tf 498 48 Td (${pdfEscape(`Page ${index + 1}/${pages.length}`)}) Tj ET`);
  }

  const objects: Buffer[] = [];
  const add = (payload: Buffer | string): number => {
    objects.push(typeof payload === "string" ? Buffer.from(payload, "latin1") : payload);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // Filled with the page references below.
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageIds: number[] = [];
  for (const sheet of pages) {
    const stream = Buffer.from(sheet.join("\n") + "\n", "latin1");
    const streamId = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("endstream", "ascii"),
      ]),
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`,
      ),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    "ascii",
  );

  const output: Buffer[] = [Buffer.from("%PDF-1.4\n%PAPOT\n", "ascii")];
  const offsets = [0];
  let offset = output[0].length;
  for (const [index, object] of objects.entries()) {
    const payload = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    offsets.push(offset);
    output.push(payload);
    offset += payload.length;
  }
  const startxref = offset;
  output.push(
    Buffer.from(
      [
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
        ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`,
      ].join(""),
      "ascii",
    ),
  );
  return new Uint8Array(Buffer.concat(output));
}
