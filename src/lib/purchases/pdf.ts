import type { PurchaseOrder } from "./domain";

/**
 * A small dependency-free A4 PDF for internal detailed purchase orders.
 * Text is encoded as WinAnsi (Latin-1) with unsupported symbols replaced.
 * No commercial invoice number or accounting state is generated here.
 */
function pdfText(saisie: string): string {
  const cleaned = saisie
    .replace(/\r?\n/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/€/g, "EUR")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[^\x20-\xFF]/g, "?");
  return cleaned.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const currency = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
const number = (valeur: number) => String(valeur).replace(".", ",");
const sheetHeight = 842;

function wrap(texte: string, width: number): string[] {
  const words = texte.replace(/\s+/g, " ").trim().split(" ");
  const lignes: string[] = [];
  let ligneTableau = "";
  for (const word of words) {
    if (word.length > width) {
      if (ligneTableau) {
        lignes.push(ligneTableau);
        ligneTableau = "";
      }
      for (let i = 0; i < word.length; i += width) lignes.push(word.slice(i, i + width));
      continue;
    }
    if (ligneTableau && ligneTableau.length + 1 + word.length > width) {
      lignes.push(ligneTableau);
      ligneTableau = word;
    } else ligneTableau = ligneTableau ? `${ligneTableau} ${word}` : word;
  }
  if (ligneTableau) lignes.push(ligneTableau);
  return lignes.length ? lignes : [""];
}

export function generateDetailedPurchaseOrderPdf(commande: PurchaseOrder): Uint8Array {
  if (commande.mode !== "DETAILED" || commande.lines.length === 0) {
    throw new Error("PURCHASE_ORDER_PDF_DETAILED_ONLY");
  }
  const pages: string[][] = [[]];
  let page = pages[0];
  let cursor = 0;

  function raw(command: string) {
    page.push(command);
  }
  function show(valeur: string, x: number, haut: number, size = 10, bold = false) {
    const font = bold ? "F2" : "F1";
    raw(`BT /${font} ${size} Tf ${x} ${sheetHeight - haut} Td (${pdfText(valeur)}) Tj ET`);
  }
  function horizontal(haut: number) {
    raw(`0.73 G 0.6 w 35 ${sheetHeight - haut} m 560 ${sheetHeight - haut} l S 0 G`);
  }
  function header() {
    show("PAPOT AGENCEMENT", 35, 42, 11, true);
    show("BON DE COMMANDE DETAILLE", 35, 70, 17, true);
    show(commande.reference, 445, 68, 12, true);
    horizontal(84);
    show(`Fournisseur : ${commande.supplierName}`, 35, 108, 10);
    show(`Chantier : ${commande.chantierName}`, 35, 126, 10);
    show(`Date : ${new Date(commande.createdAt).toLocaleDateString("fr-FR")}`, 35, 144, 10);
    show(
      commande.status === "CANCELLED" ? "STATUT : ANNULE" : "STATUT : ENREGISTRE - NON ENVOYE",
      35,
      162,
      9,
      true,
    );
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
  for (const element of commande.lines) {
    const nameLines = wrap(element.description, 47);
    const height = Math.max(29, nameLines.length * 14 + 10);
    if (cursor + height > 738) newPage();
    for (let i = 0; i < nameLines.length; i++) {
      show(nameLines[i], 40, cursor + i * 14, 9);
    }
    show(number(element.quantity), 322, cursor, 9);
    show(element.unit, 365, cursor, 9);
    show(currency(element.unitPriceHtCents), 430, cursor, 8);
    show(currency(Math.round(element.quantity * element.unitPriceHtCents)), 505, cursor, 8);
    horizontal(cursor + height - 9);
    cursor += height;
  }
  if (cursor > 696) newPage();
  if (commande.description.trim()) {
    show("Remarque :", 40, cursor + 10, 10, true);
    const notes = wrap(commande.description, 95);
    for (const element of notes.slice(0, 6)) {
      cursor += 14;
      if (cursor > 738) newPage();
      show(element, 40, cursor + 10, 9);
    }
    cursor += 24;
  }
  if (cursor > 725) newPage();
  horizontal(cursor + 10);
  show(`TOTAL HT : ${currency(commande.amountHtCents)}`, 370, cursor + 30, 12, true);
  // Footer intentionally blank: the BC is printable for the supplier.

  const objects: Buffer[] = [];
  const add = (donnees: string | Buffer) => {
    objects.push(typeof donnees === "string" ? Buffer.from(donnees, "latin1") : donnees);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // Pages tree filled after the page objects exist.
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const identifiants: number[] = [];
  for (const content of pages) {
    const stream = Buffer.from(content.join("\n") + "\n", "latin1");
    const streamObj = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("endstream", "ascii"),
      ]),
    );
    const pageObj = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObj} 0 R >>`,
    );
    identifiants.push(pageObj);
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${identifiants.length} /Kids [${identifiants.map((id) => `${id} 0 R`).join(" ")}] >>`,
    "ascii",
  );

  const sortie: Buffer[] = [Buffer.from("%PDF-1.4\n%PAPOT\n", "ascii")];
  const offsets = [0];
  let offset = sortie[0].length;
  for (const [indice, object] of objects.entries()) {
    const contenu = Buffer.concat([
      Buffer.from(`${indice + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    offsets.push(offset);
    sortie.push(contenu);
    offset += contenu.length;
  }
  const xref = offset;
  const table = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.slice(1).map((valeur) => `${String(valeur).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  ].join("");
  sortie.push(Buffer.from(table, "ascii"));
  return new Uint8Array(Buffer.concat(sortie));
}
