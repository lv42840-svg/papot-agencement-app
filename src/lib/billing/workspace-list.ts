import type { BillingDraft, BillingType } from "./domain";

export type BillingProjectSort = "RECENT" | "OLDEST" | "CLIENT" | "AMOUNT_DESC";
export type BillingProjectFilter = {
  search: string;
  type: BillingType | "ALL";
  status: BillingDraft["status"] | "ALL";
  chantierId: string;
  sort: BillingProjectSort;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

/** Client-side listing only: no mutation or alteration of billing history. */
export function filterBillingProjects(
  drafts: readonly BillingDraft[],
  filter: BillingProjectFilter,
): BillingDraft[] {
  const query = normalize(filter.search.trim());
  return drafts
    .filter((draft) => {
      if (filter.type !== "ALL" && draft.type !== filter.type) return false;
      if (filter.status !== "ALL" && draft.status !== filter.status) return false;
      if (filter.chantierId === "NONE" && draft.chantierId !== null) return false;
      if (
        filter.chantierId !== "ALL" &&
        filter.chantierId !== "NONE" &&
        draft.chantierId !== filter.chantierId
      )
        return false;
      if (!query) return true;
      return normalize(
        [draft.clientName, draft.affairName, draft.quoteLabel, draft.label, draft.notes].join(" "),
      ).includes(query);
    })
    .sort((a, b) => {
      if (filter.sort === "OLDEST") {
        return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
      }
      if (filter.sort === "CLIENT") {
        return (
          a.clientName.localeCompare(b.clientName, "fr-FR") ||
          b.createdAt.localeCompare(a.createdAt)
        );
      }
      if (filter.sort === "AMOUNT_DESC") {
        return b.amountHtCents - a.amountHtCents || b.createdAt.localeCompare(a.createdAt);
      }
      return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    });
}
