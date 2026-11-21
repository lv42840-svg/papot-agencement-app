import { lineHtCents } from "./document-lines";
import type { BillingDocumentLine } from "./domain";

export type InvoiceOuvrageGroup = {
  key: string;
  headingId: string | null;
  headingLevel: "SECTION" | "SUBSECTION" | null;
  parentHeadingId: string | null;
  title: string;
  startIndex: number;
  endExclusive: number;
  lineIds: string[];
  amountHtCents: number;
};

/** The same section/subsection hierarchy as the devis, with totals per ouvrage. */
export function groupInvoiceOuvrages(lines: readonly BillingDocumentLine[]): InvoiceOuvrageGroup[] {
  const groups: InvoiceOuvrageGroup[] = [];
  let current: InvoiceOuvrageGroup | null = null;
  let section: InvoiceOuvrageGroup | null = null;

  lines.forEach((line, index) => {
    if (line.origin === "TITLE") {
      const level = line.headingLevel ?? "SECTION";
      if (level === "SECTION") section = null;
      current = {
        key: line.id,
        headingId: line.id,
        headingLevel: level,
        parentHeadingId: level === "SUBSECTION" ? (section?.headingId ?? null) : null,
        title: line.description,
        startIndex: index,
        endExclusive: index + 1,
        lineIds: [],
        amountHtCents: 0,
      };
      if (!section) section = current;
      groups.push(current);
      return;
    }

    if (current === null) {
      current = {
        key: "unclassified",
        headingId: null,
        headingLevel: null,
        parentHeadingId: null,
        title: "Prestations sans titre",
        startIndex: index,
        endExclusive: index,
        lineIds: [],
        amountHtCents: 0,
      };
      groups.push(current);
    }

    const amount = lineHtCents(line);
    current.endExclusive = index + 1;
    current.lineIds.push(line.id);
    current.amountHtCents += amount;
    if (!Number.isSafeInteger(current.amountHtCents)) {
      throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
    }
    if (section && section !== current) {
      section.amountHtCents += amount;
      section.endExclusive = index + 1;
      if (!Number.isSafeInteger(section.amountHtCents)) {
        throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
      }
    }
  });

  return groups;
}

/**
 * A main title moves with its subsections and their lines.
 * A subsection only moves within the current main title.
 * A single prestation never jumps over a heading.
 */
export function moveInvoiceEditorRow<
  T extends {
    origin: string;
    headingLevel?: "SECTION" | "SUBSECTION";
  },
>(rows: readonly T[], index: number, direction: -1 | 1): readonly T[] {
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

  const level = row.headingLevel ?? "SECTION";
  const isBoundary = (candidate: T) =>
    candidate.origin === "TITLE" &&
    (level === "SUBSECTION" || (candidate.headingLevel ?? "SECTION") === "SECTION");
  const endOfBlock = (start: number) => {
    let end = start + 1;
    while (end < rows.length && !isBoundary(rows[end])) end++;
    return end;
  };
  const end = endOfBlock(index);

  if (direction === 1) {
    if (end >= rows.length) return rows;
    if (level === "SUBSECTION" && rows[end].headingLevel !== "SUBSECTION") return rows;
    const nextEnd = endOfBlock(end);
    return [
      ...rows.slice(0, index),
      ...rows.slice(end, nextEnd),
      ...rows.slice(index, end),
      ...rows.slice(nextEnd),
    ];
  }

  let previousStart = -1;
  for (let position = index - 1; position >= 0; position--) {
    if (isBoundary(rows[position])) {
      previousStart = position;
      break;
    }
  }
  if (previousStart < 0) return rows;
  if (level === "SUBSECTION" && rows[previousStart].headingLevel !== "SUBSECTION") {
    return rows;
  }
  return [
    ...rows.slice(0, previousStart),
    ...rows.slice(index, end),
    ...rows.slice(previousStart, index),
    ...rows.slice(end),
  ];
}
