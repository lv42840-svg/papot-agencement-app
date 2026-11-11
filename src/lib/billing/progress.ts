import type {
  BillingDraft,
  BillingLineProgress,
  BillingPayload,
  BillingSource,
} from "./domain";

export type LineProgressInput = { lineId: string; percent: number };

export type LineProgressResult = {
  amountHtCents: number;
  tax: {
    groups: BillingDraft["taxGroups"];
    vatCents: number;
    ttcCents: number;
  };
  lineProgress: BillingLineProgress[];
};

export function calculateLineProgress(
  donnees: BillingPayload,
  source: BillingSource,
  pourcentages: LineProgressInput[],
): LineProgressResult {
  const lignes = source.lines;
  if (!lignes?.length) throw new Error("BILLING_PROGRESS_LINES_UNAVAILABLE");
  if (pourcentages.length !== lignes.length) {
    throw new Error("BILLING_PROGRESS_LINES_REQUIRED");
  }

  const saisieParId = new Map<string, number>();
  for (const lignePourcentage of pourcentages) {
    if (
      saisieParId.has(lignePourcentage.lineId) ||
      !Number.isFinite(lignePourcentage.percent) ||
      lignePourcentage.percent < 0 ||
      lignePourcentage.percent > 100
    ) {
      throw new Error("BILLING_PROGRESS_PERCENT_INVALID");
    }
    saisieParId.set(lignePourcentage.lineId, lignePourcentage.percent);
  }
  if (
    saisieParId.size !== lignes.length ||
    lignes.some((ligne) => !saisieParId.has(ligne.lineId))
  ) {
    throw new Error("BILLING_PROGRESS_LINES_REQUIRED");
  }

  const brouillonsPrecedents = donnees.drafts.filter(
    (brouillon) => brouillon.quoteId === source.quoteId,
  );
  const historique = brouillonsPrecedents.filter(
    (brouillon) => brouillon.type === "PROGRESS",
  );
  if (
    historique.some(
      (brouillon) =>
        !brouillon.lineProgress?.length && brouillon.cumulativePercent === null,
    )
  ) {
    throw new Error("BILLING_PROGRESS_HISTORY_UNDETERMINED");
  }

  const avancementLignes: BillingLineProgress[] = lignes.map((ligne) => {
    const pourcentage = saisieParId.get(ligne.lineId)!;
    const precedent = historique.reduce((maximum, brouillon) => {
      const historiqueLigne = brouillon.lineProgress?.find(
        (ligneHistorique) => ligneHistorique.lineId === ligne.lineId,
      );
      const pourcentageHistorique =
        historiqueLigne?.percent ?? brouillon.cumulativePercent ?? 0;
      return Math.max(maximum, pourcentageHistorique);
    }, 0);
    if (pourcentage < precedent) {
      throw new Error("BILLING_PROGRESS_CANNOT_DECREASE");
    }
    return {
      lineId: ligne.lineId,
      percent: pourcentage,
      cumulativeHtCents: Math.round(
        (ligne.amountHtCents * pourcentage) / 100,
      ),
    };
  });

  const cibleParTaux = new Map<number, number>(
    source.contractTaxGroups.map((groupe) => [groupe.ratePercent, 0]),
  );
  for (let indice = 0; indice < lignes.length; indice += 1) {
    const ligne = lignes[indice];
    const cible = avancementLignes[indice].cumulativeHtCents;
    cibleParTaux.set(
      ligne.vatRatePercent,
      (cibleParTaux.get(ligne.vatRatePercent) ?? 0) + cible,
    );
  }

  const precedentParTaux = new Map<number, number>();
  for (const brouillon of brouillonsPrecedents) {
    for (const groupe of brouillon.taxGroups) {
      precedentParTaux.set(
        groupe.ratePercent,
        (precedentParTaux.get(groupe.ratePercent) ?? 0) + groupe.baseHtCents,
      );
    }
  }

  const groupes: BillingDraft["taxGroups"] = source.contractTaxGroups.map(
    (contrat) => {
      const cumul = cibleParTaux.get(contrat.ratePercent) ?? 0;
      const dejaPrepare = precedentParTaux.get(contrat.ratePercent) ?? 0;
      const baseHtCentimes = cumul - dejaPrepare;
      if (baseHtCentimes < 0) {
        throw new Error("BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE");
      }
      return {
        ratePercent: contrat.ratePercent,
        baseHtCents: baseHtCentimes,
        vatCents: Math.round((baseHtCentimes * contrat.ratePercent) / 100),
      };
    },
  );
  const montantHtCentimes = groupes.reduce(
    (somme, groupe) => somme + groupe.baseHtCents,
    0,
  );
  const totalPrecedent = brouillonsPrecedents.reduce(
    (somme, brouillon) => somme + brouillon.amountHtCents,
    0,
  );
  const restantContrat = source.contractHtCents - totalPrecedent;
  if (restantContrat <= 0) throw new Error("BILLING_CONTRACT_ALREADY_PREPARED");
  if (montantHtCentimes <= 0) throw new Error("BILLING_AMOUNT_INVALID");
  if (montantHtCentimes > restantContrat) {
    throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  }
  const tvaCentimes = groupes.reduce(
    (somme, groupe) => somme + groupe.vatCents,
    0,
  );
  return {
    amountHtCents: montantHtCentimes,
    tax: {
      groups: groupes,
      vatCents: tvaCentimes,
      ttcCents: montantHtCentimes + tvaCentimes,
    },
    lineProgress: avancementLignes,
  };
}
