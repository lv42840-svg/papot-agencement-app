"use client";

import { useMemo, useState } from "react";

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
      <select
        aria-label={label}
        size={Math.min(7, Math.max(3, visibleSuppliers.length + 1))}
        value={selectedId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: "100%" }}
      >
        <option value="">Choisir un fournisseur…</option>
        {visibleSuppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>
      {matches.length === 0 && search.trim() ? (
        <small>Aucun fournisseur trouvé. Vérifie Pennylane ou efface le filtre.</small>
      ) : selectedSupplier ? (
        <small>Fournisseur sélectionné : {selectedSupplier.name}</small>
      ) : (
        <small>{matches.length} fournisseur(s) dans la liste.</small>
      )}
    </div>
  );
}
