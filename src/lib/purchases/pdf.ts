import type { PurchaseOrder } from "./domain";

/**
 * A small dependency-free A4 PDF for internal detailed purchase orders.
 * Text is encoded as WinAnsi (Latin-1) with unsupported symbols replaced.
 * No commercial invoice number or accounting state is generated here.
 */
function pdfText(input: string): string {
  const cleaned = input
    .replace(/\r?\n/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/€/g, "EUR")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[^\x20-\xFF]/g, "?");
  return cleaned.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const currency = (cents: number) =>
  `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
const number = (value: number) => String(value).replace(".", ",");
const sheetHeight = 842;

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let row = "";
  for (const word of words) {
    if (word.length > width) {
      if (row) { lines.push(row); row = ""; }
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      continue;
    }
    if (row && row.length + 1 + word.length > width) {
      lines.push(row);
      row = word;
    } else row = row ? `${row} ${word}` : word;
  }
  if (row) lines.push(row);
  return lines.length ? lines : [""];
}

export function generateDetailedPurchaseOrderPdf(order: PurchaseOrder): Uint8Array {
  if (order.mode !== "DETAILED" || order.lines.length === 0) {
    throw new Error("PURCHASE_ORDER_PDF_DETAILED_ONLY");
  }
  const pages: string[][] = [[]];
  let page = pages[0];
  let cursor = 0;

  function raw(command: string) { page.push(command); }
  function show(value: string, x: number, top: number, size = 10, bold = false) {
    const font = bold ? "F2" : "F1";
    raw(`BT /${font} ${size} Tf ${x} ${sheetHeight - top} Td (${pdfText(value)}) Tj ET`);
  }
  function horizontal(top: number) {
    raw(`0.73 G 0.6 w 35 ${sheetHeight - top} m 560 ${sheetHeight - top} l S 0 G`);
  }
  function header() {
    show("PAPOT AGENCEMENT", 35, 42, 11, true);
    show("BON DE COMMANDE DETAILLE", 35, 70, 17, true);
    show(order.reference, 445, 68, 12, true);
    horizontal(84);
    show(`Fournisseur : ${order.supplierName}`, 35, 108, 10);
    show(`Chantier : ${order.chantierName}`, 35, 126, 10);
    show(`Date : ${new Date(order.createdAt).toLocaleDateString("fr-FR")}`, 35, 144, 10);
    show(order.status === "CANCELLED" ? "STATUT : ANNULE" : "STATUT : ENREGISTRE - NON ENVOYE", 35, 162, 9, true);
    horizontal(180);
    show("Designation", 40, 200, 10, true);
    show("Qte", 322, 200, 10, true);
    show("Unite", 365, 200, 10, true);
    show("PU HT", 430, 200, 10, true);
    show("Total HT", 505, 200, 10, true);
    horizontal(207);
    cursor = 225;
  }
  function newPage() {
    pages.push([]);
    page = pages[pages.length - 1];
    header();
  }
  header();
  for (const item of order.lines) {
    const nameLines = wrap(item.description, 47);
    const height = Math.max(29, nameLines.length * 14 + 10);
    if (cursor + height > 738) newPage();
    for (let i = 0; i < nameLines.length; i++) {
      show(nameLines[i], 40, cursor + i * 14, 9);
    }
    show(number(item.quantity), 322, cursor, 9);
    show(item.unit, 365, cursor, 9);
    show(currency(item.unitPriceHtCents), 430, cursor, 8);
    show(currency(Math.round(item.quantity * item.unitPriceHtCents)), 505, cursor, 8);
    horizontal(cursor + height - 9);
    cursor += height;
  }
  if (cursor > 696) newPage();
  if (order.description.trim()) {
    show("Remarque :", 40, cursor + 10, 10, true);
    const notes = wrap(order.description, 95);
    for (const item of notes.slice(0, 6)) {
      cursor += 14;
      if (cursor > 738) newPage();
      show(item, 40, cursor + 10, 9);
    }
    cursor += 24;
  }
  if (cursor > 725) newPage();
  horizontal(cursor + 10);
  show(`TOTAL HT : ${currency(order.amountHtCents)}`, 370, cursor + 30, 12, true);
  pages.forEach((commands, index) => {
    // Footer on each printed page.
    commands.push(
      `BT /F1 8 Tf 35 37 Td (Document interne - non envoye automatiquement au fournisseur - Page ${index + 1}/${pages.length}) Tj ET`,
    );
  });

  const objects: Buffer[] = [];
  const add = (data: string | Buffer) => {
    objects.push(typeof data === "string" ? Buffer.from(data, "latin1") : data);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // Pages tree filled after the page objects exist.
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const ids: number[] = [];
  for (const content of pages) {
    const stream = Buffer.from(content.join("\n") + "\n", "latin1");
    const streamObj = add(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
      stream,
      Buffer.from("endstream", "ascii"),
    ]));
    const pageObj = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObj} 0 R >>`,
    );
    ids.push(pageObj);
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${ids.length} /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] >>`,
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
  const xref = offset;
  const table = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  ].join("");
  output.push(Buffer.from(table, "ascii"));
  return new Uint8Array(Buffer.concat(output));
}
