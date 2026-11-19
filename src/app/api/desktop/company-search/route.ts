import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/permissions";
import { parseCompanySearchResults } from "@/lib/clients/company-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Public government directory, proxied server-side to avoid client-side CORS and URL injection. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "AUTH_REQUIRED" }, 401);
  if (user.mustChangePassword) return json({ error: "PASSWORD_CHANGE_REQUIRED" }, 403);

  const [commercial, clients] = await Promise.all([
    hasModuleAccess(user.id, "commercial", "READ"),
    hasModuleAccess(user.id, "clients", "READ"),
  ]);
  if (!commercial && !clients) return json({ error: "MODULE_FORBIDDEN" }, 403);

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) return json({ results: [] });
  if (query.length > 120) return json({ error: "COMPANY_LOOKUP_QUERY_INVALID" }, 400);

  const url = new URL("https://recherche-entreprises.api.gouv.fr/search");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "6");
  url.searchParams.set("etat_administratif", "A");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "PAPOT-AGENCEMENT/1.0 (company-search)" },
      signal: AbortSignal.timeout(7_000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return json({ error: "COMPANY_LOOKUP_UNAVAILABLE" }, 503);
    return json({ results: parseCompanySearchResults(await response.json()) });
  } catch {
    return json({ error: "COMPANY_LOOKUP_UNAVAILABLE" }, 503);
  }
}
