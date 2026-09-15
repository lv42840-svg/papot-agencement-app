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
