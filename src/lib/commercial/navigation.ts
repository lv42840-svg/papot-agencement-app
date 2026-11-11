export function commercialAffairHref(idAffaire: string): string {
  const idNormalise = idAffaire.trim();
  if (!idNormalise) return "/commercial";
  return `/commercial/${encodeURIComponent(idNormalise)}`;
}
