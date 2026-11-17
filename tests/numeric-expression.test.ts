import { describe, expect, it } from "vitest";
import { evaluateNumericExpression, numericExpressionInput } from "../src/lib/numeric-expression";

describe("saisie de calculs dans les cases", () => {
  it("accepte la virgule française et remplace l'expression par son résultat", () => {
    expect(evaluateNumericExpression("7+1,5", 2)).toBe(8.5);
    expect(numericExpressionInput("7+1,5", 2)).toBe("8,5");
  });
  it("respecte les priorités, parenthèses et divisions", () => {
    expect(evaluateNumericExpression("3*4", 2)).toBe(12);
    expect(evaluateNumericExpression("(3+4)*2", 2)).toBe(14);
    expect(evaluateNumericExpression("1/3", 2)).toBe(0.33);
  });
  it("arrondit sans transformer les nombres métier en textes", () => {
    expect(evaluateNumericExpression("10/4", 2)).toBe(2.5);
    expect(evaluateNumericExpression("1/3", 6)).toBe(0.333333);
  });
  it("refuse expressions invalides et valeurs hors bornes", () => {
    for (const value of ["1/0", "3-5", "2**3", "alert(1)", "7++", "4;5", "1,2.3", ""]) {
      expect(evaluateNumericExpression(value, 2)).toBeNull();
    }
    expect(evaluateNumericExpression("169", 2, 0, 168)).toBeNull();
    expect(evaluateNumericExpression("0", 2, 0.01)).toBeNull();
  });
});
