import { commercialNeedsFollowUp, isCommercialClosed, type CommercialCase } from "./domain";

export type CommercialListFilter = "active" | "follow-up" | "confirmed" | "archives";

export function commercialCaseMatchesFilter(
  item: CommercialCase,
  filter: CommercialListFilter,
  now: Date = new Date(),
): boolean {
  if (filter === "archives") return isCommercialClosed(item);
  if (filter === "confirmed") return item.status === "CONFIRMED";
  if (filter === "follow-up") {
    return (
      !isCommercialClosed(item) &&
      item.status !== "CONFIRMED" &&
      commercialNeedsFollowUp(item, now)
    );
  }
  return !isCommercialClosed(item) && item.status !== "CONFIRMED";
}

export function filterCommercialCases(
  cases: CommercialCase[],
  filter: CommercialListFilter,
  now: Date = new Date(),
): CommercialCase[] {
  return cases.filter((item) => commercialCaseMatchesFilter(item, filter, now));
}
