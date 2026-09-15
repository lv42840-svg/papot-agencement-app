export type DroppedItem<TFile> = {
  kind: string;
  getAsFile: () => TFile | null;
};

function arrayFromLike<T>(source: ArrayLike<T>): T[] {
  return Array.from({ length: source.length }, (_, index) => source[index]);
}

export function collectDroppedFiles<TFile>(
  items: ArrayLike<DroppedItem<TFile>>,
  fallbackFiles: ArrayLike<TFile>,
): TFile[] {
  const fromItems = arrayFromLike(items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is TFile => file !== null);

  return fromItems.length > 0 ? fromItems : arrayFromLike(fallbackFiles);
}
