import type {
  BillingDocumentLine,
  BillingDraft,
  BillingPayload,
  BillingSourceLine,
} from "./domain";

export function lineHtCents(ligne: BillingDocumentLine): number {
  if (ligne.origin === "TITLE") return 0;
  const resultat = Math.round(ligne.quantity * ligne.unitPriceCents);
  if (!Number.isSafeInteger(resultat) || resultat < 0) {
    throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
  }
  return resultat;
}

export function calculateInvoiceDocumentTotals(lignes: BillingDocumentLine[]) {
  const byRate = new Map<number, number>();
  const amountHtCents = lignes.reduce((somme, ligne) => {
    const valeur = lineHtCents(ligne);
    if (ligne.origin !== "TITLE") {
      byRate.set(ligne.vatRatePercent, (byRate.get(ligne.vatRatePercent) ?? 0) + valeur);
    }
    return somme + valeur;
  }, 0);
  if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
    throw new Error("BILLING_DOCUMENT_EMPTY");
  }
  const taxGroups = [...byRate.entries()]
    .map(([ratePercent, baseHtCents]) => ({
      ratePercent,
      baseHtCents,
      vatCents: Math.round((baseHtCents * ratePercent) / 100),
    }))
    .sort((a, b) => a.ratePercent - b.ratePercent);
  const vatCents = taxGroups.reduce((somme, group) => somme + group.vatCents, 0);
  return { amountHtCents, taxGroups, vatCents, totalTtcCents: amountHtCents + vatCents };
}

function distributeAmounts(
  lignes: BillingSourceLine[],
  amountHtCents: number,
  weights: number[],
): number[] {
  if (!lignes.length) return [];
  let weightsUsed = weights.map((valeur) => Math.max(0, valeur));
  if (weightsUsed.reduce((somme, valeur) => somme + valeur, 0) <= 0) {
    weightsUsed = lignes.map((ligne) => ligne.amountHtCents);
  }
  const totalWeights = weightsUsed.reduce((somme, valeur) => somme + valeur, 0);
  if (totalWeights <= 0) return lignes.map((_, i) => (i === 0 ? amountHtCents : 0));
  const parts = lignes.map((_, indice) => {
    const raw = (amountHtCents * weightsUsed[indice]) / totalWeights;
    return { index: indice, amount: Math.floor(raw), fraction: raw % 1 };
  });
  let remaining = amountHtCents - parts.reduce((somme, part) => somme + part.amount, 0);
  for (const part of [...parts].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (remaining <= 0) break;
    part.amount++;
    remaining--;
  }
  return parts.map((part) => part.amount);
}

/** Generates an independent editable snapshot; the retained quote is never changed. */
export function buildInvoiceDocumentLines(
  brouillon: BillingDraft,
  contenu: BillingPayload,
): BillingDocumentLine[] {
  const draftIndex = contenu.drafts.findIndex((element) => element.id === brouillon.id);
  const prior = contenu.drafts
    .slice(0, draftIndex < 0 ? contenu.drafts.length : draftIndex)
    .filter((element) => element.quoteId === brouillon.quoteId);
  const sourceLines = brouillon.lines ?? [];
  const sortie: BillingDocumentLine[] = [];

  for (const group of brouillon.taxGroups) {
    const matching = sourceLines.filter((ligne) => ligne.vatRatePercent === group.ratePercent);
    if (!matching.length) {
      sortie.push({
        id: globalThis.crypto.randomUUID(),
        origin: "FREE",
        sourceLineId: null,
        description: `Prestation selon devis ${brouillon.quoteLabel}`,
        quantity: 1,
        unit: "forfait",
        unitPriceCents: group.baseHtCents,
        vatRatePercent: group.ratePercent,
      });
      continue;
    }

    const previousSituations = prior.filter((element) => element.type === "PROGRESS");
    const weights = matching.map((ligne) => {
      const cible = brouillon.lineProgress?.find(
        (ligneTableau) => ligneTableau.lineId === ligne.lineId,
      )?.cumulativeHtCents;
      if (cible === undefined) return ligne.amountHtCents;
      const previousTarget = previousSituations.reduce((maximum, element) => {
        const ligneTableau = element.lineProgress?.find((entree) => entree.lineId === ligne.lineId);
        const montant =
          ligneTableau?.cumulativeHtCents ??
          (element.cumulativePercent === null
            ? 0
            : Math.round((ligne.amountHtCents * element.cumulativePercent) / 100));
        return Math.max(maximum, montant);
      }, 0);
      return Math.max(0, cible - previousTarget);
    });
    const allocated = distributeAmounts(matching, group.baseHtCents, weights);
    matching.forEach((source, indice) => {
      const montant = allocated[indice];
      const quantity = source.quantity ?? 1;
      const roundedUnit = Math.round(montant / quantity);
      const exact =
        montant > 0 &&
        Number.isSafeInteger(roundedUnit) &&
        Math.round(quantity * roundedUnit) === montant;
      sortie.push({
        id: globalThis.crypto.randomUUID(),
        origin: "QUOTE",
        sourceLineId: source.lineId,
        // A retained quote can have a whitespace-only label. Keep its amount and
        // source link, but give the editable invoice row a valid description.
        description: source.description.trim()
          ? source.description
          : `Prestation du devis ${brouillon.quoteLabel}`,
        quantity: exact ? quantity : 1,
        unit: exact ? (source.unit ?? "u") : "forfait",
        unitPriceCents: exact ? roundedUnit : montant,
        vatRatePercent: source.vatRatePercent,
      });
    });
  }
  return sortie;
}
