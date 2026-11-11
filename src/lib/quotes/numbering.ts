import type { QuoteItem } from "./model";

type ParentState = {
  number: string;
  nextChild: number;
};

export function buildQuoteItemNumbers(elements: QuoteItem[]): Map<string, string> {
  const numbers = new Map<string, string>();
  const parents = new Map<string, ParentState>();
  let nextTopLevel = 0;

  for (const element of elements) {
    if (element.kind === "SECTION" || element.parentId === null) {
      nextTopLevel += 1;
      const number = String(nextTopLevel);
      numbers.set(element.id, number);
      if (element.kind === "SECTION") {
        parents.set(element.id, { number, nextChild: 0 });
      }
      continue;
    }

    const parent = parents.get(element.parentId);
    if (!parent) {
      nextTopLevel += 1;
      numbers.set(element.id, String(nextTopLevel));
      continue;
    }

    parent.nextChild += 1;
    const number = `${parent.number}.${parent.nextChild}`;
    numbers.set(element.id, number);
    if (element.kind === "SUBSECTION") {
      parents.set(element.id, { number, nextChild: 0 });
    }
  }

  return numbers;
}
