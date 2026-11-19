import { lineHtCents } from "./document-lines";
import type { BillingDocumentLine } from "./domain";

export type InvoiceOuvrageGroup = {
  key: string;
  headingId: string | null;
  title: string;
  startIndex: number;
  endExclusive: number;
  lineIds: string[];
  amountHtCents: number;
};

/** A TITLE starts an ouvrage; the following prestations belong to it until the next TITLE. */
export function groupInvoiceOuvrages(
  lines: readonly BillingDocumentLine[],
): InvoiceOuvrageGroup[] {
  const groups: InvoiceOuvrageGroup[] = [];
  let current: InvoiceOuvrageGroup | null = null;

  lines.forEach((line, index) => {
    if (line.origin === "TITLE") {
      current = {
        key: line.id,
        headingId: line.id,
        title: line.description,
        startIndex: index,
        endExclusive: index + 1,
        lineIds: [],
        amountHtCents: 0,
      };
      groups.push(current);
      return;
    }
    if (current === null) {
      current = {
        key: "unclassified",
        headingId: null,
        title: "Prestations sans titre",
        startIndex: index,
        endExclusive: index,
        lineIds: [],
        amountHtCents: 0,
      };
      groups.push(current);
    }
    current.endExclusive = index + 1;
    current.lineIds.push(line.id);
    current.amountHtCents += lineHtCents(line);
    if (!Number.isSafeInteger(current.amountHtCents)) {
      throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
    }
  });

  return groups;
}

/** A title moves together with its children. A prestation cannot cross a title accidentally. */
export function moveInvoiceEditorRow<T extends { origin: string }>(
  rows: readonly T[],
  index: number,
  direction: -1 | 1,
): readonly T[] {
  const row = rows[index];
  if (!row) return rows;

  if (row.origin !== "TITLE") {
    const adjacent = index + direction;
    if (adjacent < 0 || adjacent >= rows.length || rows[adjacent].origin === "TITLE") {
      return rows;
    }
    const moved = [...rows];
    [moved[index], moved[adjacent]] = [moved[adjacent], moved[index]];
    return moved;
  }

  let end = rows.findIndex((item, position) => position > index && item.origin === "TITLE");
  if (end < 0) end = rows.length;

  if (direction === 1) {
    if (end >= rows.length) return rows;
    let nextEnd = rows.findIndex((item, position) => position > end && item.origin === "TITLE");
    if (nextEnd < 0) nextEnd = rows.length;
    return [
      ...rows.slice(0, index),
      ...rows.slice(end, nextEnd),
      ...rows.slice(index, end),
      ...rows.slice(nextEnd),
    ];
  }

  let previousStart = -1;
  for (let position = index - 1; position >= 0; position--) {
    if (rows[position].origin === "TITLE") {
      previousStart = position;
      break;
    }
  }
  if (previousStart < 0) return rows;
  return [
    ...rows.slice(0, previousStart),
    ...rows.slice(index, end),
    ...rows.slice(previousStart, index),
    ...rows.slice(end),
  ];
}
