/** Small, validated projection of the public API Recherche d'entreprises response. */
export type CompanySuggestion = {
  name: string;
  siret: string;
  addressLine1: string;
  postalCode: string;
  city: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The API may return several similarly named companies: never silently pick one. */
export function parseCompanySearchResults(value: unknown): CompanySuggestion[] {
  const source = object(value);
  const results = Array.isArray(source?.results) ? source.results : [];
  const seen = new Set<string>();
  const matches: CompanySuggestion[] = [];

  for (const raw of results) {
    const company = object(raw);
    const office = object(company?.siege);
    const siret = string(office?.siret);
    const name = string(company?.nom_complet) || string(company?.nom_raison_sociale);
    if (!/^\d{14}$/.test(siret) || !name || seen.has(siret)) continue;
    seen.add(siret);
    matches.push({
      name: name.slice(0, 240),
      siret,
      addressLine1: string(office?.adresse).slice(0, 240),
      postalCode: string(office?.code_postal).slice(0, 20),
      city: string(office?.libelle_commune).slice(0, 160),
    });
    if (matches.length === 6) break;
  }
  return matches;
}
