/** Saisie multi-choix : seul l'élément coché change, même après un filtrage de la liste. */
export function toggleCheckboxChoice(
  selectedIds: readonly string[],
  id: string,
  checked: boolean,
  multiple = true,
): string[] {
  if (!multiple) return checked ? [id] : [];
  return checked
    ? [...new Set([...selectedIds, id])]
    : selectedIds.filter((value) => value !== id);
}

/** Cocher uniquement les résultats visibles, conserver les choix masqués. */
export function checkVisibleChoices(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  return [...new Set([...selectedIds, ...visibleIds])];
}

/** Décocher uniquement les résultats visibles, conserver les choix masqués. */
export function uncheckVisibleChoices(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visible = new Set(visibleIds);
  return selectedIds.filter((id) => !visible.has(id));
}
