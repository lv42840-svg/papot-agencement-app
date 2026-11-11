export type QuoteComponentMoveDirection = "UP" | "DOWN";

export function canMoveQuoteComponent(
  componentCount: number,
  indice: number,
  direction: QuoteComponentMoveDirection,
): boolean {
  if (!Number.isInteger(indice) || indice < 0 || indice >= componentCount) return false;
  const targetIndex = direction === "UP" ? indice - 1 : indice + 1;
  return targetIndex >= 0 && targetIndex < componentCount;
}

export function moveQuoteComponent<T>(
  components: readonly T[],
  indice: number,
  direction: QuoteComponentMoveDirection,
): T[] {
  const suivant = [...components];
  if (!canMoveQuoteComponent(suivant.length, indice, direction)) return suivant;

  const targetIndex = direction === "UP" ? indice - 1 : indice + 1;
  [suivant[indice], suivant[targetIndex]] = [suivant[targetIndex], suivant[indice]];
  return suivant;
}

export function duplicateQuoteComponent<T extends { key: string; id?: string }>(
  components: readonly T[],
  indice: number,
  createKey: () => string,
): T[] {
  const source = components[indice];
  if (!source) return [...components];

  const duplicate = { ...source, key: createKey(), id: undefined } as T;
  return [...components.slice(0, indice + 1), duplicate, ...components.slice(indice + 1)];
}
