import { lineHtCents } from "./document-lines";
import type { NativeIssuedInvoice } from "./native-issuance";

/** Legal PDF rendered only from the immutable numbered snapshot, never from draft data. */
const PAGE_HEIGHT = 842;
const CONTENT_BOTTOM = 735;
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",") + " EUR";
const dateFR = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);

function escaped(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u20ac/g, "EUR")
    .replace(/[\u0152\u0153]/g, "oe")
    .replace(/[^\x20-\xFF]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, limit: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    let rest = word;
    while (rest.length > limit) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    if (!rest) continue;
    if (current && current.length + rest.length + 1 > limit) {
      lines.push(current);
      current = rest;
    } else {
      current = current ? current + " " + rest : rest;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function generateNativeInvoicePdf(
  invoice: NativeIssuedInvoice,
  options: { testOnly?: boolean } = {},
): Uint8Array {
  const pages: string[][] = [];
  let current: string[] = [];
  let y = 0;
  const add = (value: string) => current.push(value);
  const text = (value: string, x: number, top: number, size = 9, bold = false) =>
    add(
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
  const rule = (top: number) =>
    add("0.75 G 0.5 w 40 " + (PAGE_HEIGHT - top) + " m 555 " + (PAGE_HEIGHT - top) + " l S 0 G");

  function nextPage() {
    if (pages.length >= 200) throw new Error("BILLING_NATIVE_PDF_PAGE_LIMIT");
    current = [];
    pages.push(current);
    if (options.testOnly) text("DOCUMENT TEST / SANS VALEUR FISCALE", 40, 19, 11, true);
    text(invoice.seller.name, 40, 43, 13, true);
    text(
      (options.testOnly ? "TEST - FACTURE SIMULEE " : "FACTURE N° ") + invoice.number,
      40,
      78,
      16,
      true,
    );
    text("Émise le " + dateFR(invoice.issuedOn), 400, 78, 9);
    rule(91);
    if (pages.length === 1) {
      text(invoice.seller.legalForm + " · SIRET " + invoice.seller.siret, 40, 111, 8);
      text(
        invoice.seller.address + ", " + invoice.seller.postalCode + " " + invoice.seller.city,
        40,
        128,
        8,
      );
      text("RCS : " + invoice.seller.rcs + " · TVA : " + invoice.seller.vatNumber, 40, 145, 8);
      if (invoice.seller.capital) text("Capital social : " + invoice.seller.capital, 40, 161, 8);
      text("Client : " + invoice.buyer.name, 40, 188, 10, true);
      text(
        invoice.buyer.address + ", " + invoice.buyer.postalCode + " " + invoice.buyer.city,
        40,
        204,
        8,
      );
      if (invoice.buyer.addressLine2) text(invoice.buyer.addressLine2, 40, 219, 8);
      if (invoice.buyer.siret) text("SIRET client : " + invoice.buyer.siret, 40, 236, 8);
      if (invoice.buyer.vatNumber) text("TVA client : " + invoice.buyer.vatNumber, 310, 236, 8);
      y = 263;
    } else {
      text("Client : " + invoice.buyer.name + " · " + invoice.affairName, 40, 109, 8);
      y = 137;
    }
    rule(y);
    text("Désignation", 40, y + 14, 9, true);
    text("Qté", 331, y + 14, 8, true);
    text("P.U. HT", 378, y + 14, 8, true);
    text("TVA", 463, y + 14, 8, true);
    text("Total HT", 510, y + 14, 8, true);
    y += 25;
    rule(y);
    y += 10;
  }

  function write(values: string[], bold = false) {
    for (const value of values) {
      for (const part of wrap(value, 90)) {
        if (y > CONTENT_BOTTOM - 17) nextPage();
        text(part, 43, y + 10, 8.5, bold);
        y += 14;
      }
    }
  }

  nextPage();

  for (const line of invoice.documentLines) {
    const isHeading = line.origin === "TITLE";
    const pieces = wrap(line.description, isHeading ? 85 : 49);
    let first = true;
    for (const description of pieces) {
      if (y > CONTENT_BOTTOM - 26) nextPage();
      text(description, isHeading ? 43 : 43, y + 10, isHeading ? 9 : 8, isHeading);
      if (!isHeading && first) {
        text(
          String(line.quantity).replace(".", ",") + " " + line.unit.slice(0, 5),
          330,
          y + 10,
          7.5,
        );
        text(money(line.unitPriceCents), 376, y + 10, 7.3);
        text(String(line.vatRatePercent) + " %", 463, y + 10, 7.5);
        text(money(lineHtCents(line)), 495, y + 10, 7.3);
      }
      y += 14;
      first = false;
    }
    y += 6;
    rule(y);
    y += 5;
  }

  write([
    "Document : " +
      {
        STANDARD: "Facture classique",
        DEPOSIT: "Facture d'acompte",
        PROGRESS: "Situation de travaux",
        FINAL: "Facture de solde",
      }[invoice.type],
    "Intitulé : " + invoice.label,
    "Chantier : " + invoice.affairName,
    "Référence devis : " + invoice.quoteLabel,
    "Date de prestation : " + dateFR(invoice.serviceOn),
    "Nature : " +
      {
        SERVICE: "Prestations de services",
        GOODS: "Livraison de biens",
        MIXED: "Biens et services",
      }[invoice.operationCategory],
    ...(invoice.buyerPurchaseOrderNumber
      ? ["Bon de commande client : " + invoice.buyerPurchaseOrderNumber]
      : []),
    ...(invoice.priorDepositNumbers.length
      ? ["Acomptes précédents : " + invoice.priorDepositNumbers.join(", ")]
      : []),
  ]);
  if (invoice.notes.trim()) write(["Observations :", ...wrap(invoice.notes, 90)]);
  if (invoice.seller.insurerName) {
    write([
      "Assurance professionnelle : " + invoice.seller.insurerName,
      ...(invoice.seller.insurerAddress ? ["Assureur : " + invoice.seller.insurerAddress] : []),
      ...(invoice.seller.insuranceCoverage
        ? wrap("Couverture : " + invoice.seller.insuranceCoverage, 90)
        : []),
    ]);
  }
  if (y > CONTENT_BOTTOM - 185) nextPage();
  write(["Total HT : " + money(invoice.amountHtCents)], true);
  for (const group of invoice.taxGroups) {
    write([
      "TVA " +
        group.ratePercent +
        " % sur " +
        money(group.baseHtCents) +
        " : " +
        money(group.vatCents),
    ]);
  }
  write(["TOTAL TTC : " + money(invoice.totalTtcCents)], true);
  if (invoice.retentionTtcCents > 0) {
    write([
      "Retenue de garantie TTC : " + money(invoice.retentionTtcCents),
      "Hors retenue à encaisser : " + money(invoice.totalTtcCents - invoice.retentionTtcCents),
    ]);
  }
  write([
    "Échéance : " + dateFR(invoice.dueOn),
    "Conditions de paiement : " + invoice.paymentTerms,
    "Pénalités de retard : taux annuel " + String(invoice.latePenaltyRatePercent) + " %.",
    ...(invoice.collectionFeeCents > 0
      ? ["Indemnité forfaitaire de recouvrement : " + money(invoice.collectionFeeCents)]
      : []),
    ...(invoice.vatOnDebits ? ["TVA acquittée sur les débits."] : []),
    ...(invoice.seller.iban ? ["IBAN : " + invoice.seller.iban] : []),
    ...(invoice.seller.bic ? ["BIC : " + invoice.seller.bic] : []),
  ]);

  for (const [index, page] of pages.entries()) {
    if (options.testOnly) {
      page.push("BT /F2 13 Tf 90 380 Td (SPECIMEN - TEST - NON VALABLE) Tj ET");
      page.push("BT /F2 8 Tf 45 100 Td (TEST - NE PAS ENVOYER AU CLIENT) Tj ET");
    }
    page.push("0.75 G 0.5 w 40 65 m 555 65 l S 0 G");
    page.push(
      "BT /F1 8 Tf 40 48 Td (" +
        escaped("Facture " + invoice.number + " · PAPOT · copie d'une émission enregistrée") +
        ") Tj ET",
    );
    page.push(
      "BT /F1 8 Tf 505 48 Td (" + escaped("Page " + (index + 1) + "/" + pages.length) + ") Tj ET",
    );
  }

  const objects: Buffer[] = [];
  function append(input: string | Buffer): number {
    objects.push(typeof input === "string" ? Buffer.from(input, "latin1") : input);
    return objects.length;
  }
  append("<< /Type /Catalog /Pages 2 0 R >>");
  append("");
  append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const page of pages) {
    const bytes = Buffer.from(page.join("\n") + "\n", "latin1");
    const streamId = append(
      Buffer.concat([
        Buffer.from("<< /Length " + bytes.length + " >>\nstream\n", "ascii"),
        bytes,
        Buffer.from("endstream", "ascii"),
      ]),
    );
    pageIds.push(
      append(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources " +
          "<< /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " +
          streamId +
          " 0 R >>",
      ),
    );
  }
  objects[1] = Buffer.from(
    "<< /Type /Pages /Count " +
      pageIds.length +
      " /Kids [" +
      pageIds.map((id) => id + " 0 R").join(" ") +
      "] >>",
    "ascii",
  );
  const output: Buffer[] = [Buffer.from("%PDF-1.4\n%PAPOT\n", "ascii")];
  const offsets: number[] = [0];
  let offset = output[0].length;
  for (const [index, obj] of objects.entries()) {
    const bytes = Buffer.concat([
      Buffer.from(index + 1 + " 0 obj\n", "ascii"),
      obj,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    offsets.push(offset);
    output.push(bytes);
    offset += bytes.length;
  }
  output.push(
    Buffer.from(
      "xref\n0 " +
        (objects.length + 1) +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((value) => String(value).padStart(10, "0") + " 00000 n \n")
          .join("") +
        "trailer\n<< /Size " +
        (objects.length + 1) +
        " /Root 1 0 R >>\nstartxref\n" +
        offset +
        "\n%%EOF\n",
      "ascii",
    ),
  );
  return new Uint8Array(Buffer.concat(output));
}
