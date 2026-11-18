"use client";

import {
  toggleCheckboxChoice,
  checkVisibleChoices,
  uncheckVisibleChoices,
} from "@/lib/ui/checkbox-selection";

export type CheckboxChoice = { id: string; label: string; disabled?: boolean };

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
  const selectableOptions = options.filter((option) => !option.disabled);
  const visibleIds = new Set(selectableOptions.map((option) => option.id));
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
              cursor: disabled || option.disabled ? "default" : "pointer",
              minWidth: 0,
            }}
          >
            <input
              type="checkbox"
              aria-label={option.label}
              style={{
                width: 18,
                height: 18,
                minHeight: 18,
                padding: 0,
                flexShrink: 0,
                accentColor: "#7558b3",
              }}
              checked={chosen.has(option.id)}
              disabled={disabled || option.disabled}
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
            disabled={
              disabled ||
              selectableOptions.length === 0 ||
              selectableOptions.every((option) => chosen.has(option.id))
            }
            onClick={() => onChange(checkVisibleChoices(selectedIds, [...visibleIds]))}
          >
            Tout cocher (résultats visibles)
          </button>
          <button
            type="button"
            className="secondaryButton"
            disabled={disabled || !selectableOptions.some((option) => chosen.has(option.id))}
            onClick={() => onChange(uncheckVisibleChoices(selectedIds, [...visibleIds]))}
          >
            Tout décocher (résultats visibles)
          </button>
        </div>
      ) : null}
    </div>
  );
}
