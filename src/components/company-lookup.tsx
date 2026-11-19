"use client";

import { useEffect, useState } from "react";
import type { CompanySuggestion } from "@/lib/clients/company-lookup";

export function CompanyLookup({
  query,
  onSelect,
  disabled = false,
}: {
  query: string;
  onSelect: (company: CompanySuggestion) => void;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<CompanySuggestion[]>([]);
  const [completedTerm, setCompletedTerm] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const term = query.trim();
  const searching = !disabled && term.length >= 3 && term !== selectedName;
  const visibleResults = completedTerm === term ? results : [];

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      setResults([]);
      try {
        const response = await fetch(
          `/api/desktop/company-search?q=${encodeURIComponent(term)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("COMPANY_LOOKUP_UNAVAILABLE");
        const data = (await response.json()) as { results?: CompanySuggestion[] };
        if (!controller.signal.aborted) {
          setResults(Array.isArray(data.results) ? data.results : []);
          setCompletedTerm(term);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, term]);

  if (!searching) return null;
  return (
    <div className="companyLookup" aria-live="polite">
      {loading ? <small>Recherche de l’entreprise et de son SIRET…</small> : null}
      {!loading && error ? (
        <small>Annuaire indisponible. Tu peux continuer et renseigner le SIRET manuellement.</small>
      ) : null}
      {!loading && !error && visibleResults.length > 0 ? (
        <>
          <small>Sélectionne la bonne entreprise pour récupérer le SIRET de son siège :</small>
          <div className="companyLookupResults">
            {visibleResults.map((company) => (
              <button
                key={company.siret}
                type="button"
                onClick={() => {
                  setSelectedName(company.name);
                  setResults([]);
                  onSelect(company);
                }}
              >
                <strong>{company.name}</strong>
                <span>
                  SIRET {company.siret}
                  {company.city ? ` · ${company.city}` : ""}
                  {company.postalCode ? ` (${company.postalCode})` : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {!loading && !error && completedTerm === term && visibleResults.length === 0 ? (
        <small>Aucune correspondance affichée. La saisie manuelle reste possible.</small>
      ) : null}
      <style jsx>{`
        .companyLookup { width: 100%; margin-top: 5px; }
        .companyLookup small { display: block; opacity: .75; margin: 4px 0; }
        .companyLookupResults { display: grid; gap: 5px; margin: 6px 0; }
        .companyLookupResults button {
          display: flex; flex-direction: column; align-items: flex-start; text-align: left;
          width: 100%; padding: 9px 11px; border: 1px solid #c9bfdf;
          border-radius: 8px; background: #f7f3fc; color: #312842; cursor: pointer;
        }
        .companyLookupResults button:hover, .companyLookupResults button:focus-visible {
          border-color: #8066b4; background: #eee6fa;
        }
        .companyLookupResults span { font-size: .85em; margin-top: 3px; }
      `}</style>
    </div>
  );
}
