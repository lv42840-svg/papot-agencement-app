"use client";

import { groupInvoiceOuvrages } from "@/lib/billing/ouvrage-structure";
import type { BillingDocumentLine } from "@/lib/billing/domain";

const currency = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export function InvoiceOuvragesNavigator({
  lines,
  disabled,
  onNavigate,
  onInsertLine,
}: {
  lines: BillingDocumentLine[];
  disabled: boolean;
  onNavigate: (id: string) => void;
  onInsertLine: (index: number) => void;
}) {
  const groups = groupInvoiceOuvrages(lines);
  if (groups.length === 0) return null;

  return (
    <nav aria-label="Navigation par ouvrages" className="invoiceOuvragesNavigator">
      <div>
        <strong>Ouvrages et titres</strong>
        <p>Retrouve un ouvrage, ouvre ses lignes ou ajoute une prestation au bon endroit.</p>
      </div>
      <div className="invoiceOuvragesGroups">
        {groups.map((group, index) => (
          <details key={group.key} open={index === 0}>
            <summary>
              {group.title} · {currency(group.amountHtCents)} HT
            </summary>
            <div>
              {group.headingId && (
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => onNavigate(group.headingId!)}
                >
                  Modifier le titre
                </button>
              )}
              {group.lineIds.map((id) => {
                const line = lines.find((item) => item.id === id);
                return (
                  <button
                    type="button"
                    key={id}
                    className="secondaryButton"
                    onClick={() => onNavigate(id)}
                  >
                    {line?.description ?? "Prestation"}
                  </button>
                );
              })}
              <button
                type="button"
                className="secondaryButton"
                disabled={disabled || lines.length >= 1000}
                onClick={() => onInsertLine(group.endExclusive)}
              >
                + Prestation dans cet ouvrage
              </button>
            </div>
          </details>
        ))}
      </div>
    </nav>
  );
}
