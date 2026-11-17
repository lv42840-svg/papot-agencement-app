"use client";

import { useEffect, useState } from "react";
import { evaluateNumericExpression } from "@/lib/numeric-expression";

type CalculatedAmountInputProps = {
  valueCents: number;
  onCommit: (amountCents: number) => void;
  disabled?: boolean;
  allowNegative?: boolean;
  label?: string;
};

/** Accepte les saisies 250+125, 300/2, (120+30)*2 sans exécuter de code. */
export function CalculatedAmountInput({
  valueCents,
  onCommit,
  disabled = false,
  allowNegative = false,
  label,
}: CalculatedAmountInputProps) {
  const [expression, setExpression] = useState(String(valueCents / 100).replace(".", ","));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setExpression(String(valueCents / 100).replace(".", ","));
    setInvalid(false);
  }, [valueCents]);

  function commit() {
    const euros = evaluateNumericExpression(
      expression,
      2,
      allowNegative ? -1_000_000_000 : 0,
      1_000_000_000,
    );
    if (euros === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setExpression(String(euros).replace(".", ","));
    onCommit(Math.round(euros * 100));
  }

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        placeholder="Ex. 250+125"
        value={expression}
        disabled={disabled}
        onChange={(event) => {
          setExpression(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {invalid ? (
        <small role="alert" style={{ color: "#ac293b" }}>
          Calcul incorrect : utilise des nombres et +, -, * ou /.
        </small>
      ) : null}
    </>
  );
}
