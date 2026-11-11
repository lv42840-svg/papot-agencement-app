import type { QuoteOption, QuotePricingConfig } from "./adjustments";
import { quotePricingConfigSchema } from "./adjustments";
import type { QuoteItem } from "./model";
import type { NativeQuotesPayload } from "./store";

type OptionTarget = Exclude<QuoteItem, { kind: "COMMENT" }>;

function optionTarget(elements: QuoteItem[], option: QuoteOption): OptionTarget {
  const cible = elements.find((element) => element.id === option.targetItemId);
  if (!cible) throw new Error("QUOTE_OPTION_TARGET_NOT_FOUND");
  if (cible.kind === "COMMENT" || cible.kind !== option.targetKind) {
    throw new Error("QUOTE_OPTION_TARGET_INVALID");
  }
  return cible;
}

function targetContains(
  elements: QuoteItem[],
  ancetre: OptionTarget,
  descendant: OptionTarget,
): boolean {
  if (ancetre.id === descendant.id) return true;
  if (ancetre.kind === "LINE") return false;

  if (descendant.parentId === ancetre.id) return true;
  if (!descendant.parentId) return false;

  const parent = elements.find((element) => element.id === descendant.parentId);
  return parent?.parentId === ancetre.id;
}

function optionsOverlap(elements: QuoteItem[], gauche: QuoteOption, droite: QuoteOption): boolean {
  const cibleGauche = optionTarget(elements, gauche);
  const cibleDroite = optionTarget(elements, droite);
  return (
    targetContains(elements, cibleGauche, cibleDroite) ||
    targetContains(elements, cibleDroite, cibleGauche)
  );
}

export function assertQuoteOptionCanBeUpserted(
  elements: QuoteItem[],
  optionsExistantes: QuoteOption[],
  candidate: QuoteOption,
): void {
  optionTarget(elements, candidate);
  for (const optionExistante of optionsExistantes) {
    if (optionExistante.id === candidate.id) continue;
    if (optionsOverlap(elements, optionExistante, candidate)) {
      throw new Error("QUOTE_OPTION_TARGET_DUPLICATE");
    }
  }
}

export function assertQuotePricingIntegrity(
  elements: QuoteItem[],
  configurationTarifaire: QuotePricingConfig,
): void {
  const configurationValidee = quotePricingConfigSchema.parse(configurationTarifaire);
  for (const option of configurationValidee.options) optionTarget(elements, option);

  for (
    let indiceGauche = 0;
    indiceGauche < configurationValidee.options.length;
    indiceGauche += 1
  ) {
    for (
      let indiceDroit = indiceGauche + 1;
      indiceDroit < configurationValidee.options.length;
      indiceDroit += 1
    ) {
      if (
        optionsOverlap(
          elements,
          configurationValidee.options[indiceGauche],
          configurationValidee.options[indiceDroit],
        )
      ) {
        throw new Error("QUOTE_OPTION_TARGET_DUPLICATE");
      }
    }
  }
}

export function normalizeQuotePricingAfterModelMutation(
  donnees: NativeQuotesPayload,
  idDevis: string,
): NativeQuotesPayload {
  const devis = donnees.quotes.find((candidat) => candidat.id === idDevis);
  if (!devis) throw new Error("QUOTE_NOT_FOUND");

  const elementsParId = new Map(devis.model.items.map((element) => [element.id, element]));
  const options = devis.pricingConfig.options.filter((option) => {
    const cible = elementsParId.get(option.targetItemId);
    return Boolean(cible && cible.kind !== "COMMENT" && cible.kind === option.targetKind);
  });
  const configurationTarifaire = quotePricingConfigSchema.parse({
    ...devis.pricingConfig,
    options,
  });
  assertQuotePricingIntegrity(devis.model.items, configurationTarifaire);
  devis.pricingConfig = configurationTarifaire;
  return donnees;
}
