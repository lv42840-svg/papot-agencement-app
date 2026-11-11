import type { BillingDraft, BillingType } from "./domain";

export type BillingProjectSort = "RECENT" | "OLDEST" | "CLIENT" | "AMOUNT_DESC";
export type BillingProjectFilter = {
  search: string;
  type: BillingType | "ALL";
  status: BillingDraft["status"] | "ALL";
  chantierId: string;
  sort: BillingProjectSort;
};

function normalize(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

/** Client-side listing only: no mutation or alteration of billing history. */
export function filterBillingProjects(
  brouillons: readonly BillingDraft[],
  filtre: BillingProjectFilter,
): BillingDraft[] {
  const recherche = normalize(filtre.search.trim());
  return brouillons
    .filter((brouillon) => {
      if (filtre.type !== "ALL" && brouillon.type !== filtre.type) return false;
      if (filtre.status !== "ALL" && brouillon.status !== filtre.status) {
        return false;
      }
      if (filtre.chantierId === "NONE" && brouillon.chantierId !== null) {
        return false;
      }
      if (
        filtre.chantierId !== "ALL" &&
        filtre.chantierId !== "NONE" &&
        brouillon.chantierId !== filtre.chantierId
      ) {
        return false;
      }
      if (!recherche) return true;
      return normalize(
        [
          brouillon.clientName,
          brouillon.affairName,
          brouillon.quoteLabel,
          brouillon.label,
          brouillon.notes,
        ].join(" "),
      ).includes(recherche);
    })
    .sort((gauche, droite) => {
      if (filtre.sort === "OLDEST") {
        return (
          gauche.createdAt.localeCompare(droite.createdAt) || gauche.id.localeCompare(droite.id)
        );
      }
      if (filtre.sort === "CLIENT") {
        return (
          gauche.clientName.localeCompare(droite.clientName, "fr-FR") ||
          droite.createdAt.localeCompare(gauche.createdAt)
        );
      }
      if (filtre.sort === "AMOUNT_DESC") {
        return (
          droite.amountHtCents - gauche.amountHtCents ||
          droite.createdAt.localeCompare(gauche.createdAt)
        );
      }
      return droite.createdAt.localeCompare(gauche.createdAt) || gauche.id.localeCompare(droite.id);
    });
}
