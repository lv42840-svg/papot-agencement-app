import type { QuoteItem } from "./model";

type ParentState = {
  number: string;
  nextChild: number;
};

export function buildQuoteItemNumbers(items: QuoteItem[]): Map<string, string> {
  const numbers = new Map<string, string>();
  const parents = new Map<string, ParentState>();
  let nextTopLevel = 0;

  for (const item of items) {
    if (item.kind === "SECTION" || item.parentId === null) {
      nextTopLevel += 1;
      const number = String(nextTopLevel);
      numbers.set(item.id, number);
      if (item.kind === "SECTION") {
        parents.set(item.id, { number, nextChild: 0 });
      }
      continue;
    }

    const parent = parents.get(item.parentId);
    if (!parent) {
      nextTopLevel += 1;
      numbers.set(item.id, String(nextTopLevel));
      continue;
    }

    parent.nextChild += 1;
    const number = `${parent.number}.${parent.nextChild}`;
    numbers.set(item.id, number);
    if (item.kind === "SUBSECTION") {
      parents.set(item.id, { number, nextChild: 0 });
    }
  }

  return numbers;
}
