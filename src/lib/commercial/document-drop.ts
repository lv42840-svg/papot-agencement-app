export type DroppedItem<TFichier> = {
  kind: string;
  getAsFile: () => TFichier | null;
};

function arrayFromLike<TElement>(source: ArrayLike<TElement>): TElement[] {
  return Array.from({ length: source.length }, (_, indice) => source[indice]);
}

export function collectDroppedFiles<TFichier>(
  elements: ArrayLike<DroppedItem<TFichier>>,
  fichiersSecours: ArrayLike<TFichier>,
): TFichier[] {
  const fichiersDepuisElements = arrayFromLike(elements)
    .filter((element) => element.kind === "file")
    .map((element) => element.getAsFile())
    .filter((fichier): fichier is TFichier => fichier !== null);

  return fichiersDepuisElements.length > 0
    ? fichiersDepuisElements
    : arrayFromLike(fichiersSecours);
}
