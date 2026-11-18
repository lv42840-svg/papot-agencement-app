"use client";

import { CheckboxChoiceList } from "@/components/checkbox-choice-list";

/** Destinations filtrées depuis la recherche du BC, sélection multiple sans Ctrl. */
export function PurchaseDestinationMultiPicker({
  options,
  selectedIds,
  onChange,
  disabled = false,
  label = "Chantiers à ajouter au BC",
}: {
  options: readonly { id: string; label: string }[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 6, width: "100%", maxWidth: 670 }}>
      <CheckboxChoiceList
        label={label}
        options={options}
        selectedIds={selectedIds}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
