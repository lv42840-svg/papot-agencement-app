import { z } from "zod";

export const QUOTE_DEFAULT_VALIDITY_DAYS = 30;
export const QUOTE_QUANTITY_PRECISION = 6;
export const QUOTE_MAX_QUANTITY = 1_000_000_000;
export const QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH = 120;

export const quoteStatusSchema = z.enum([
  "DRAFT",
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
  SENT: "Envoyé",
  ACCEPTED: "Envoyé (ancien statut)",
  REJECTED: "Envoyé (ancien statut)",
  CANCELLED: "Annulé",
  SUPERSEDED: "Version précédente",
};

export function quoteDocumentStatusLabel(status: QuoteStatus): string {
  return QUOTE_DOCUMENT_STATUS_LABELS[status];
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

  constructor(private readonly input: string) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.input.length) throw quantityError();
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.index];
      if (operator !== "+" && operator !== "-") return value;
      this.index += 1;
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.index];
      if (operator !== "*" && operator !== "/") return value;
      this.index += 1;
      const right = this.parseFactor();
      if (operator === "/" && right === 0) {
        throw new Error("QUOTE_QUANTITY_DIVISION_BY_ZERO");
      }
      value = operator === "*" ? value * right : value / right;
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();

    const unary = this.input[this.index];
    if (unary === "+" || unary === "-") {
      this.index += 1;
      const value = this.parseFactor();
      return unary === "-" ? -value : value;
    }

    if (this.input[this.index] === "(") {
      this.index += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.input[this.index] !== ")") throw quantityError();
      this.index += 1;
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.index;
    let hasDigit = false;
    let hasDecimalSeparator = false;

    while (this.index < this.input.length) {
      const character = this.input[this.index];
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
    const value = Number(this.input.slice(start, this.index));
    if (!Number.isFinite(value)) throw quantityError();
    return value;
  }

  private skipWhitespace() {
    while (/\s/.test(this.input[this.index] ?? "")) this.index += 1;
  }
}

function roundQuantity(value: number): number {
  const factor = 10 ** QUOTE_QUANTITY_PRECISION;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function assertMoneyCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("QUOTE_MONEY_INVALID");
  }
}

function assertPercent(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("QUOTE_PERCENT_INVALID");
  }
}

function assertQuantity(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > QUOTE_MAX_QUANTITY) {
    throw new Error("QUOTE_QUANTITY_INVALID");
  }
}

export function parseQuoteQuantityInput(input: string): QuoteQuantity {
  const formula = input.trim();
  if (!formula || formula.length > QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH) {
    throw quantityError();
  }

  const normalized = formula.replace(/,/g, ".");
  if (!/^[0-9+\-*/().\s]+$/.test(normalized)) throw quantityError();

  const parsed = new QuantityExpressionParser(normalized).parse();
  const quantity = roundQuantity(parsed);
  assertQuantity(quantity);

  const simpleNumber = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(formula);
  return {
    quantity,
    formula: simpleNumber ? null : formula,
  };
}

export function formatQuoteNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error("QUOTE_YEAR_INVALID");
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new Error("QUOTE_SEQUENCE_INVALID");
  }
  return `D-${year}-${String(sequence).padStart(4, "0")}`;
}

export function quoteValidityDate(issueDate: string, days = QUOTE_DEFAULT_VALIDITY_DAYS): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !Number.isInteger(days) || days < 1) {
    throw new Error("QUOTE_VALIDITY_INVALID");
  }

  const date = new Date(`${issueDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== issueDate) {
    throw new Error("QUOTE_VALIDITY_INVALID");
  }

  date.setUTCDate(date.getUTCDate() + days);
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

export function calculateQuoteLine(input: {
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number;
  vatRatePercent: number;
}): QuoteLineCalculation {
  assertQuantity(input.quantity);
  assertMoneyCents(input.unitPriceCents);
  const discountPercent = input.discountPercent ?? 0;
  assertPercent(discountPercent);
  assertPercent(input.vatRatePercent);

  const grossHtCents = Math.round(input.quantity * input.unitPriceCents);
  assertMoneyCents(grossHtCents);
  const discountAmountCents = percentageAmountCents(grossHtCents, discountPercent);
  const netHtCents = grossHtCents - discountAmountCents;
  const vatAmountCents = percentageAmountCents(netHtCents, input.vatRatePercent);

  return {
    grossHtCents,
    discountPercent,
    discountAmountCents,
    netHtCents,
    vatRatePercent: input.vatRatePercent,
    vatAmountCents,
    ttcCents: netHtCents + vatAmountCents,
  };
}
