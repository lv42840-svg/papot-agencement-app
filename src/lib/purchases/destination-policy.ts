import {
  purchaseOrderAllocations,
  purchaseOrderAmount,
  type PurchaseOrder,
  type PurchaseOrderInput,
} from "./domain";

/** Keep historical amounts on closed sites, but do not create or change their commitments. */
export function purchaseChantierNamesForInput(
  saisie: PurchaseOrderInput,
  chantiers: readonly { id: string; name: string; status: string }[],
  precedente?: PurchaseOrder,
): ReadonlyMap<string, string> {
  const chantiersParId = new Map(chantiers.map((chantier) => [chantier.id, chantier]));
  const affectationsPrecedentes = new Map(
    (precedente ? purchaseOrderAllocations(precedente) : [])
      .filter((ligne) => ligne.chantierId !== null)
      .map((ligne) => [ligne.chantierId, ligne.amountHtCents]),
  );
  const lignes =
    saisie.mode === "QUICK"
      ? saisie.allocations
      : [
          {
            chantierId: saisie.chantierId,
            amountHtCents: purchaseOrderAmount(saisie),
          },
        ];
  for (const ligne of lignes) {
    if (ligne.chantierId === null) continue;
    const chantier = chantiersParId.get(ligne.chantierId);
    if (!chantier) throw new Error("PURCHASE_CHANTIER_NOT_FOUND");
    if (
      chantier.status !== "ACTIVE" &&
      affectationsPrecedentes.get(chantier.id) !== ligne.amountHtCents
    ) {
      throw new Error("PURCHASE_CHANTIER_NOT_ACTIVE");
    }
  }
  // Removing a closed site's allocation is a deliberate close-review action, not a silent edit.
  for (const [id, montant] of affectationsPrecedentes) {
    const chantier = id ? chantiersParId.get(id) : undefined;
    if (
      chantier &&
      chantier.status !== "ACTIVE" &&
      !lignes.some(
        (ligne) => ligne.chantierId === id && ligne.amountHtCents === montant,
      )
    ) {
      throw new Error("PURCHASE_CHANTIER_NOT_ACTIVE");
    }
  }
  return new Map(chantiers.map((chantier) => [chantier.id, chantier.name]));
}
