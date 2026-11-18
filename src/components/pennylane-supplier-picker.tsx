"use client";

import { useMemo, useState } from "react";
import { CheckboxChoiceList } from "@/components/checkbox-choice-list";

export type PennylaneSupplierChoice = { id: string; name: string };

function searchableText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

/** La recherche reste locale : les fiches fournisseurs sont toujours gérées dans Pennylane. */
export function PennylaneSupplierPicker({
  suppliers,
  selectedId,
  onChange,
  disabled = false,
  label = "Fournisseur du BC",
}: {
  suppliers: readonly PennylaneSupplierChoice[];
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const matches = useMemo(() => {
    const query = searchableText(search.trim());
    return suppliers.filter((supplier) => searchableText(supplier.name).includes(query));
  }, [search, suppliers]);
  const visibleSuppliers = useMemo(
    () => [
      ...matches,
      ...suppliers.filter(
        (supplier) =>
          supplier.id === selectedId && !matches.some((item) => item.id === supplier.id),
      ),
    ],
    [matches, selectedId, suppliers],
  );
  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedId);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <input
        type="search"
        aria-label="Rechercher un fournisseur Pennylane"
        placeholder="Tape le nom du fournisseur pour filtrer…"
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
      />
      <CheckboxChoiceList
        label={label}
        options={visibleSuppliers.map((supplier) => ({
          id: supplier.id,
          label: supplier.name,
        }))}
        selectedIds={selectedId ? [selectedId] : []}
        onChange={(ids) => onChange(ids[0] ?? "")}
        disabled={disabled}
        multiple={false}
        emptyMessage="Aucun fournisseur trouvé. Efface ou modifie la recherche."
      />
      {selectedSupplier ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "10px 13px",
            background: "#f0ebfc",
            color: "#35246b",
            border: "1px solid #a594db",
            borderRadius: 8,
            fontSize: 15,
          }}
        >
          Fournisseur sélectionné :{" "}
          <strong style={{ fontWeight: 800 }}>{selectedSupplier.name}</strong>
        </div>
      ) : (
        <small>{matches.length} fournisseur(s) dans la liste.</small>
      )}
      {matches.length === 0 && search.trim() ? (
        <small>Aucun fournisseur trouvé pour ce filtre. Tu peux effacer la recherche.</small>
      ) : null}
    </div>
  );
}
