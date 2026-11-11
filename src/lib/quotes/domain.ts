import { z } from "zod";

export const QUOTE_DEFAULT_VALIDITY_DAYS = 30;
export const QUOTE_QUANTITY_PRECISION = 6;
export const QUOTE_MAX_QUANTITY = 1_000_000_000;
export const QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH = 120;

export const quoteStatusSchema = z.enum([
  "DRAFT",
  "FROZEN",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
  "SUPERSEDED",
]);

export const quoteVersionSchema = z.number().int().min(1);
export const quoteMoneyCentsSchema = z.number().int().safe().min(0);
export const quotePercentSchema = z.number().finite().min(0).max(100);

export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

export const QUOTE_DOCUMENT_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Brouillon",
  FROZEN: "Validé",
  SENT: "Envoyé",
  ACCEPTED: "Envoyé (ancien statut)",
  REJECTED: "Envoyé (ancien statut)",
  CANCELLED: "Annulé",
  SUPERSEDED: "Version précédente",
};

export function quoteDocumentStatusLabel(statut: QuoteStatus): string {
  return QUOTE_DOCUMENT_STATUS_LABELS[statut];
}

export type QuoteQuantity = {
  quantity: number;
  formula: string | null;
};

export type QuoteDiscountKind = "LINE" | "SECTION" | "GLOBAL";

export type QuoteDiscountStep = {
  kind: QuoteDiscountKind;
  percent: number;
  amountCents: number;
  remainingCents: number;
};

export type QuoteLineCalculation = {
  grossHtCents: number;
  discountPercent: number;
  discountAmountCents: number;
  netHtCents: number;
  vatRatePercent: number;
  vatAmountCents: number;
  ttcCents: number;
};

const quantityError = () => new Error("QUOTE_QUANTITY_EXPRESSION_INVALID");

class QuantityExpressionParser {
  private index = 0;

  constructor(private readonly saisie: string) {}

  parse(): number {
    const valeur = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.saisie.length) throw quantityError();
    return valeur;
  }

  private parseExpression(): number {
    let valeur = this.parseTerm();

    while (true) {
      this.skipWhitespace();
      const operator = this.saisie[this.index];
      if (operator !== "+" && operator !== "-") return valeur;
      this.index += 1;
      const droite = this.parseTerm();
      valeur = operator === "+" ? valeur + droite : valeur - droite;
    }
  }

  private parseTerm(): number {
    let valeur = this.parseFactor();

    while (true) {
      this.skipWhitespace();
      const operator = this.saisie[this.index];
      if (operator !== "*" && operator !== "/") return valeur;
      this.index += 1;
      const droite = this.parseFactor();
      if (operator === "/" && droite === 0) {
        throw new Error("QUOTE_QUANTITY_DIVISION_BY_ZERO");
      }
      valeur = operator === "*" ? valeur * droite : valeur / droite;
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();

    const unary = this.saisie[this.index];
    if (unary === "+" || unary === "-") {
      this.index += 1;
      const valeur = this.parseFactor();
      return unary === "-" ? -valeur : valeur;
    }

    if (this.saisie[this.index] === "(") {
      this.index += 1;
      const valeur = this.parseExpression();
      this.skipWhitespace();
      if (this.saisie[this.index] !== ")") throw quantityError();
      this.index += 1;
      return valeur;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const debut = this.index;
    let hasDigit = false;
    let hasDecimalSeparator = false;

    while (this.index < this.saisie.length) {
      const character = this.saisie[this.index];
      if (character >= "0" && character <= "9") {
        hasDigit = true;
        this.index += 1;
        continue;
      }
      if (character === "." && !hasDecimalSeparator) {
        hasDecimalSeparator = true;
        this.index += 1;
        continue;
      }
      break;
    }

    if (!hasDigit) throw quantityError();
    const valeur = Number(this.saisie.slice(debut, this.index));
    if (!Number.isFinite(valeur)) throw quantityError();
    return valeur;
  }

  private skipWhitespace() {
    while (/\s/.test(this.saisie[this.index] ?? "")) this.index += 1;
  }
}

function roundQuantity(valeur: number): number {
  const factor = 10 ** QUOTE_QUANTITY_PRECISION;
  return Math.round((valeur + Number.EPSILON) * factor) / factor;
}

function assertMoneyCents(valeur: number) {
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new Error("QUOTE_MONEY_INVALID");
  }
}

function assertPercent(valeur: number) {
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
    throw new Error("QUOTE_PERCENT_INVALID");
  }
}

function assertQuantity(valeur: number) {
  if (!Number.isFinite(valeur) || valeur <= 0 || valeur > QUOTE_MAX_QUANTITY) {
    throw new Error("QUOTE_QUANTITY_INVALID");
  }
}

export function parseQuoteQuantityInput(saisie: string): QuoteQuantity {
  const formula = saisie.trim();
  if (!formula || formula.length > QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH) {
    throw quantityError();
  }

  const normalized = formula.replace(/,/g, ".");
  if (!/^[0-9+\-*/().\s]+$/.test(normalized)) throw quantityError();

  const analyse = new QuantityExpressionParser(normalized).parse();
  const quantity = roundQuantity(analyse);
  assertQuantity(quantity);

  const simpleNumber = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(formula);
  return {
    quantity,
    formula: simpleNumber ? null : formula,
  };
}

export function formatQuoteNumber(annee: number, sequence: number): string {
  if (!Number.isInteger(annee) || annee < 2000 || annee > 9999) {
    throw new Error("QUOTE_YEAR_INVALID");
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new Error("QUOTE_SEQUENCE_INVALID");
  }
  return `D-${annee}-${String(sequence).padStart(4, "0")}`;
}

export function quoteValidityDate(issueDate: string, jours = QUOTE_DEFAULT_VALIDITY_DAYS): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !Number.isInteger(jours) || jours < 1) {
    throw new Error("QUOTE_VALIDITY_INVALID");
  }

  const date = new Date(`${issueDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== issueDate) {
    throw new Error("QUOTE_VALIDITY_INVALID");
  }

  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

export function percentageAmountCents(amountCents: number, percent: number): number {
  assertMoneyCents(amountCents);
  assertPercent(percent);
  return Math.round((amountCents * percent) / 100);
}

export function applySequentialQuoteDiscounts(
  amountCents: number,
  discounts: Array<{ kind: QuoteDiscountKind; percent: number }>,
): { finalCents: number; steps: QuoteDiscountStep[] } {
  assertMoneyCents(amountCents);
  let remainingCents = amountCents;
  const steps = discounts.map((discount) => {
    assertPercent(discount.percent);
    const discountAmountCents = percentageAmountCents(remainingCents, discount.percent);
    remainingCents -= discountAmountCents;
    return {
      kind: discount.kind,
      percent: discount.percent,
      amountCents: discountAmountCents,
      remainingCents,
    };
  });

  return { finalCents: remainingCents, steps };
}

export function calculateQuoteLine(saisie: {
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number;
  vatRatePercent: number;
}): QuoteLineCalculation {
  assertQuantity(saisie.quantity);
  assertMoneyCents(saisie.unitPriceCents);
  const discountPercent = saisie.discountPercent ?? 0;
  assertPercent(discountPercent);
  assertPercent(saisie.vatRatePercent);

  const grossHtCents = Math.round(saisie.quantity * saisie.unitPriceCents);
  assertMoneyCents(grossHtCents);
  const discountAmountCents = percentageAmountCents(grossHtCents, discountPercent);
  const netHtCents = grossHtCents - discountAmountCents;
  const vatAmountCents = percentageAmountCents(netHtCents, saisie.vatRatePercent);

  return {
    grossHtCents,
    discountPercent,
    discountAmountCents,
    netHtCents,
    vatRatePercent: saisie.vatRatePercent,
    vatAmountCents,
    ttcCents: netHtCents + vatAmountCents,
  };
}
