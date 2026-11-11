import { commercialNeedsFollowUp, isCommercialClosed, type CommercialCase } from "./domain";

export type CommercialListFilter = "active" | "follow-up" | "confirmed" | "archives";

export function commercialCaseMatchesFilter(
  affaire: CommercialCase,
  filtre: CommercialListFilter,
  maintenant: Date = new Date(),
): boolean {
  if (filtre === "archives") return isCommercialClosed(affaire);
  if (filtre === "confirmed") return affaire.status === "CONFIRMED";
  if (filtre === "follow-up") {
    return (
      !isCommercialClosed(affaire) &&
      affaire.status !== "CONFIRMED" &&
      commercialNeedsFollowUp(affaire, maintenant)
    );
  }
  return !isCommercialClosed(affaire) && affaire.status !== "CONFIRMED";
}

export function filterCommercialCases(
  affaires: CommercialCase[],
  filtre: CommercialListFilter,
  maintenant: Date = new Date(),
): CommercialCase[] {
  return affaires.filter((affaire) => commercialCaseMatchesFilter(affaire, filtre, maintenant));
}
