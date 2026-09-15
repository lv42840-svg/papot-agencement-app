export function commercialAffairHref(caseId: string): string {
  const normalizedId = caseId.trim();
  if (!normalizedId) return "/commercial";
  return `/commercial/${encodeURIComponent(normalizedId)}`;
}
