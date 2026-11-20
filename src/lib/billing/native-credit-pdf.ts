import type { NativeIssuedInvoice } from "./native-issuance";
import type { NativeCreditNote } from "./native-credit-notes";

const PAGE_HEIGHT = 842;
const BOTTOM = 735;
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",") + " EUR";
const dateFR = (value: string) =>
  [value.slice(8, 10), value.slice(5, 7), value.slice(0, 4)].join("/");

function escaped(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u20ac/g, "EUR")
    .replace(/[^\x20-\xFF]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, limit: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const result: string[] = [];
  let current = "";
  for (const rawWord of words) {
    let word = rawWord;
    while (word.length > limit) {
      if (current) {
        result.push(current);
        current = "";
      }
      result.push(word.slice(0, limit));
      word = word.slice(limit);
    }
    if (!word) continue;
    if (current && current.length + 1 + word.length > limit) {
      result.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) result.push(current);
  return result.length ? result : [""];
}

export function generateNativeCreditNotePdf(
  note: NativeCreditNote,
  original: NativeIssuedInvoice,
): Uint8Array {
  if (
    note.originalInvoiceId !== original.id ||
    note.originalInvoiceNumber !== original.number ||
    note.originalInvoiceIssuedOn !== original.issuedOn ||
    note.clientId !== original.clientId
  ) {
    throw new Error("BILLING_NATIVE_CREDIT_SOURCE_CORRUPT");
  }
  const pages: string[][] = [];
  let content: string[] = [];
  let y = 0;
  function text(value: string, x: number, top: number, size = 9, bold = false) {
    content.push(
      "BT /" +
        (bold ? "F2" : "F1") +
        " " +
        size +
        " Tf " +
        x +
        " " +
        (PAGE_HEIGHT - top) +
        " Td (" +
        escaped(value) +
        ") Tj ET",
    );
  }
  function rule(top: number) {
    content.push(
      "0.75 G 0.5 w 40 " + (PAGE_HEIGHT - top) + " m 555 " + (PAGE_HEIGHT - top) + " l S 0 G",
    );
  }
  function newPage() {
    if (pages.length >= 100) throw new Error("BILLING_NATIVE_CREDIT_PDF_PAGE_LIMIT");
    content = [];
    pages.push(content);
    text(original.seller.name, 40, 45, 13, true);
    text("AVOIR N° " + note.number, 40, 78, 16, true);
    text("Émis le " + dateFR(note.issuedOn), 405, 78, 9);
    rule(91);
    y = 125;
  }
  function write(lines: string[], bold = false) {
    for (const line of lines) {
      for (const part of wrap(line, 86)) {
        if (y > BOTTOM - 20) newPage();
        text(part, 43, y + 10, bold ? 10 : 9, bold);
        y += 18;
      }
    }
  }

  newPage();
  write([
    original.seller.legalForm + " · SIRET " + original.seller.siret,
    original.seller.address + ", " + original.seller.postalCode + " " + original.seller.city,
    "RCS : " + original.seller.rcs + " · TVA : " + original.seller.vatNumber,
    ...(original.seller.capital ? ["Capital social : " + original.seller.capital] : []),
  ]);
  y += 14;
  write([
    "Client : " + original.buyer.name,
    original.buyer.address + ", " + original.buyer.postalCode + " " + original.buyer.city,
    ...(original.buyer.addressLine2 ? [original.buyer.addressLine2] : []),
    ...(original.buyer.siret ? ["SIRET client : " + original.buyer.siret] : []),
    ...(original.buyer.vatNumber ? ["TVA client : " + original.buyer.vatNumber] : []),
  ]);
  y += 20;
  rule(y);
  y += 12;
  write(["Facture d'origine : " + note.originalInvoiceNumber], true);
  write([
    "Date de la facture d'origine : " + dateFR(note.originalInvoiceIssuedOn),
    "Type : " + (note.mode === "FULL" ? "Solde restant à créditer" : "Avoir partiel"),
    "Chantier : " + original.affairName,
    "Référence devis : " + original.quoteLabel,
  ]);
  y += 13;
  write(["Motif de l'avoir :"], true);
  write([note.reason]);
  y += 20;
  rule(y);
  y += 14;
  write(["DÉTAIL DES MONTANTS CRÉDITÉS"], true);
  for (const tax of note.taxGroups) {
    write([
      "Taux TVA : " + String(tax.ratePercent).replace(".", ",") + " %",
      "  Base HT corrigée : -" + money(tax.baseHtCents),
      "  TVA corrigée : -" + money(tax.vatCents),
    ]);
    y += 5;
  }
  y += 15;
  rule(y);
  y += 12;
  write([
    "TOTAL HT DE L'AVOIR : -" + money(note.amountHtCents),
    "TOTAL TVA DE L'AVOIR : -" + money(note.vatCents),
  ]);
  write(["TOTAL TTC DE L'AVOIR : -" + money(note.totalTtcCents)], true);
  y += 15;
  write([
    "Cet avoir réduit le montant de la facture d'origine " + note.originalInvoiceNumber + ".",
    "Les éventuels remboursements sont suivis séparément.",
    ...(original.vatOnDebits ? ["TVA acquittée sur les débits."] : []),
  ]);
  for (const [index, page] of pages.entries()) {
    page.push("0.75 G 0.5 w 40 65 m 555 65 l S 0 G");
    page.push(
      "BT /F1 8 Tf 40 48 Td (" +
        escaped("Avoir PAPOT " + note.number + " · Facture " + note.originalInvoiceNumber) +
        ") Tj ET",
    );
    page.push(
      "BT /F1 8 Tf 505 48 Td (" + escaped("Page " + (index + 1) + "/" + pages.length) + ") Tj ET",
    );
  }
  const objects: Buffer[] = [];
  function addObject(value: string | Buffer): number {
    objects.push(typeof value === "string" ? Buffer.from(value, "latin1") : value);
    return objects.length;
  }
  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const pageIds: number[] = [];
  for (const page of pages) {
    const bytes = Buffer.from(page.join("\n") + "\n", "latin1");
    const stream = addObject(
      Buffer.concat([
        Buffer.from("<< /Length " + bytes.length + " >>\nstream\n", "ascii"),
        bytes,
        Buffer.from("endstream", "ascii"),
      ]),
    );
    pageIds.push(
      addObject(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources " +
          "<< /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " +
          stream +
          " 0 R >>",
      ),
    );
  }
  objects[1] = Buffer.from(
    "<< /Type /Pages /Count " +
      pageIds.length +
      " /Kids [" +
      pageIds.map((item) => item + " 0 R").join(" ") +
      "] >>",
    "ascii",
  );
  const output: Buffer[] = [Buffer.from("%PDF-1.4\n%PAPOT\n", "ascii")];
  const offsets: number[] = [0];
  let currentOffset = output[0].length;
  for (const [index, item] of objects.entries()) {
    const bytes = Buffer.concat([
      Buffer.from(index + 1 + " 0 obj\n", "ascii"),
      item,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    offsets.push(currentOffset);
    output.push(bytes);
    currentOffset += bytes.length;
  }
  output.push(
    Buffer.from(
      "xref\n0 " +
        (objects.length + 1) +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
          .join("") +
        "trailer\n<< /Size " +
        (objects.length + 1) +
        " /Root 1 0 R >>\nstartxref\n" +
        currentOffset +
        "\n%%EOF\n",
      "ascii",
    ),
  );
  return new Uint8Array(Buffer.concat(output));
}
