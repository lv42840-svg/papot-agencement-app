"use client";

import {
  toggleCheckboxChoice,
  checkVisibleChoices,
  uncheckVisibleChoices,
} from "@/lib/ui/checkbox-selection";

export type CheckboxChoice = { id: string; label: string };

/** Un clic par choix, sans Ctrl. Les éléments masqués par un filtre restent sélectionnés. */
export function CheckboxChoiceList({
  options,
  selectedIds,
  onChange,
  label,
  disabled = false,
  multiple = true,
  emptyMessage = "Aucun résultat pour cette recherche.",
  maxHeight = 248,
}: {
  options: readonly CheckboxChoice[];
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
  disabled?: boolean;
  multiple?: boolean;
  emptyMessage?: string;
  maxHeight?: number;
}) {
  const visibleIds = new Set(options.map((option) => option.id));
  const chosen = new Set(selectedIds);

  function toggle(id: string, checked: boolean) {
    onChange(toggleCheckboxChoice(selectedIds, id, checked, multiple));
  }

  return (
    <div style={{ display: "grid", gap: 7 }}>
      <div
        role="group"
        aria-label={label}
        style={{
          display: "grid",
          gap: 2,
          maxHeight,
          overflowY: "auto",
          border: "1px solid #d9d3e7",
          borderRadius: 8,
          background: "#fff",
          padding: 6,
        }}
      >
        {options.map((option) => (
          <label
            key={option.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 9px",
              borderRadius: 6,
              background: chosen.has(option.id) ? "#f1eafa" : "transparent",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              aria-label={option.label}
              checked={chosen.has(option.id)}
              disabled={disabled}
              onChange={(event) => toggle(option.id, event.target.checked)}
            />
            <span style={{ fontSize: 14 }}>{option.label}</span>
          </label>
        ))}
        {options.length === 0 ? <small>{emptyMessage}</small> : null}
      </div>
      <small>
        {selectedIds.length} sélectionné(s). Les choix restent cochés lorsque la recherche change.
      </small>
      {multiple ? (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondaryButton"
            disabled={disabled || options.length === 0 || options.every((option) => chosen.has(option.id))}
            onClick={() => onChange(checkVisibleChoices(selectedIds, [...visibleIds]))}
          >
            Tout cocher (résultats visibles)
          </button>
          <button
            type="button"
            className="secondaryButton"
            disabled={disabled || !options.some((option) => chosen.has(option.id))}
            onClick={() => onChange(uncheckVisibleChoices(selectedIds, [...visibleIds]))}
          >
            Tout décocher (résultats visibles)
          </button>
        </div>
      ) : null}
    </div>
  );
}
