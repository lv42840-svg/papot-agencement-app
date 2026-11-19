/**
 * A nine-digit SIREN is not a SIRET. If Pennylane has no usable
 * establishment identifier, retrieve the public headquarters SIRET
 * for that exact SIREN. Never guess a NIC or accept a similar company.
 */
export function headquartersSiretForSiren(siren: string, payload: unknown): string {
  if (!/^\d{9}$/.test(siren) || !payload || typeof payload !== "object") return "";
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return "";

  const company = results.find((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    return (item as { siren?: unknown }).siren === siren;
  }) as { siege?: { siret?: unknown } } | undefined;
  const siret = company?.siege?.siret;
  return typeof siret === "string" && /^\d{14}$/.test(siret) && siret.startsWith(siren)
    ? siret
    : "";
}

export async function findHeadquartersSiret(
  siren: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!/^\d{9}$/.test(siren)) return "";

  const url = new URL("https://recherche-entreprises.api.gouv.fr/search");
  url.searchParams.set("q", siren);
  url.searchParams.set("per_page", "1");

  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "";
    return headquartersSiretForSiren(siren, await response.json());
  } catch {
    // A directory outage must not prevent an explicit Pennylane link.
    return "";
  }
}
