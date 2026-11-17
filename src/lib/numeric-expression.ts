/**
 * Petite calculatrice de saisie : chiffres, virgule/point, parenthèses et + - * /.
 * Aucun code de l'utilisateur n'est exécuté. Les montants métier restent des nombres.
 */
export function evaluateNumericExpression(
  source: string,
  precision: number,
  min = 0,
  max = 1_000_000_000,
): number | null {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) return null;
  const text = source.trim();
  if (!text || text.length > 120) return null;
  let position = 0;
  const skipSpaces = () => {
    while (position < text.length && /\s/.test(text[position])) position += 1;
  };
  const factor = (): number => {
    skipSpaces();
    const marker = text[position];
    if (marker === "+" || marker === "-") {
      position += 1;
      const value = factor();
      return marker === "-" ? -value : value;
    }
    if (marker === "(") {
      position += 1;
      const value = expression();
      skipSpaces();
      if (text[position] !== ")") return NaN;
      position += 1;
      return value;
    }
    const match = /^(?:\d+(?:[,.]\d+)?|[,.]\d+)/.exec(text.slice(position));
    if (!match) return NaN;
    position += match[0].length;
    return Number(match[0].replace(",", "."));
  };
  const term = (): number => {
    let value = factor();
    while (true) {
      skipSpaces();
      const operation = text[position];
      if (operation !== "*" && operation !== "/") return value;
      position += 1;
      const right = factor();
      value = operation === "*" ? value * right : value / right;
    }
  };
  const expression = (): number => {
    let value = term();
    while (true) {
      skipSpaces();
      const operation = text[position];
      if (operation !== "+" && operation !== "-") return value;
      position += 1;
      const right = term();
      value = operation === "+" ? value + right : value - right;
    }
  };
  const value = expression();
  skipSpaces();
  if (position !== text.length || !Number.isFinite(value) || value < min || value > max)
    return null;
  const scale = 10 ** precision;
  const rounded = Math.round((value + Number.EPSILON * Math.abs(value)) * scale) / scale;
  return Number.isFinite(rounded) && rounded >= min && rounded <= max ? rounded : null;
}

export function numericExpressionInput(
  value: string,
  precision: number,
  min = 0,
  max = 1_000_000_000,
): string {
  const result = evaluateNumericExpression(value, precision, min, max);
  return result === null ? value : String(result).replace(".", ",");
}
