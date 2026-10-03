export type QuoteComponentMoveDirection = "UP" | "DOWN";

export function canMoveQuoteComponent(
  componentCount: number,
  index: number,
  direction: QuoteComponentMoveDirection,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= componentCount) return false;
  const targetIndex = direction === "UP" ? index - 1 : index + 1;
  return targetIndex >= 0 && targetIndex < componentCount;
}

export function moveQuoteComponent<T>(
  components: readonly T[],
  index: number,
  direction: QuoteComponentMoveDirection,
): T[] {
  const next = [...components];
  if (!canMoveQuoteComponent(next.length, index, direction)) return next;

  const targetIndex = direction === "UP" ? index - 1 : index + 1;
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function duplicateQuoteComponent<T extends { key: string; id?: string }>(
  components: readonly T[],
  index: number,
  createKey: () => string,
): T[] {
  const source = components[index];
  if (!source) return [...components];

  const duplicate = { ...source, key: createKey(), id: undefined } as T;
  return [...components.slice(0, index + 1), duplicate, ...components.slice(index + 1)];
}
