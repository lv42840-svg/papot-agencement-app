"use client";

/** Même principe que dans les Heures : une liste filtrée, multi-sélection au clavier. */
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
      <label style={{ display: "grid", gap: 5 }}>
        {label} (plusieurs choix possibles)
        <select
          multiple
          size={Math.min(8, Math.max(3, options.length))}
          aria-label={label}
          disabled={disabled}
          value={selectedIds.filter((id) => options.some((option) => option.id === id))}
          onChange={(event) => {
            const visible = new Set(options.map((item) => item.id));
            const chosen = Array.from(event.currentTarget.selectedOptions, (item) => item.value);
            onChange([...new Set([...selectedIds.filter((id) => !visible.has(id)), ...chosen])]);
          }}
          style={{ width: "100%", minHeight: 88 }}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {options.length === 0 ? <small>Aucune destination pour ce filtre.</small> : null}
      <small>
        {selectedIds.length} destination(s) sélectionnée(s). Ctrl ou Maj pour plusieurs choix.
        La recherche ne retire pas les choix déjà effectués.
      </small>
    </div>
  );
}
