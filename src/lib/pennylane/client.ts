import { z } from "zod";
import type { PennylaneConfig, PennylaneResource } from "./config";

const BASE_URL = "https://app.pennylane.com/api/external/v2/";
const PAGE_SIZE = 100;
const MAX_PAGES = 2000;
const MAX_RECORDS = 200000;

const itemSchema = z.object({ id: z.union([z.number(), z.string()]) }).passthrough();
const pageSchema = z.object({
  items: z.array(itemSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
}).passthrough();

export type PennylaneItem = z.infer<typeof itemSchema>;
export type PennylaneFetcher = typeof fetch;

function errorCode(status: number): string {
  if (status === 401) return "PENNYLANE_TOKEN_INVALID";
  if (status === 403) return "PENNYLANE_SCOPE_FORBIDDEN";
  if (status === 429) return "PENNYLANE_RATE_LIMITED";
  return "PENNYLANE_HTTP_ERROR";
}

async function requestJson(url: URL, config: PennylaneConfig, fetcher: PennylaneFetcher): Promise<unknown> {
  // Never log response bodies, URL query cursors, tokens or raw provider errors.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new Error("PENNYLANE_NETWORK_ERROR");
    }
    if ((response.status === 429 || response.status === 503) && attempt < 2) {
      const seconds = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(seconds) && seconds >= 0
        ? Math.min(seconds * 1000, 3000)
        : (attempt + 1) * 500;
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (!response.ok) throw new Error(errorCode(response.status));
    try {
      return await response.json();
    } catch {
      throw new Error("PENNYLANE_RESPONSE_INVALID");
    }
  }
  throw new Error("PENNYLANE_RATE_LIMITED");
}

export async function verifyPennylaneCompany(
  config: PennylaneConfig,
  fetcher: PennylaneFetcher = fetch,
): Promise<string> {
  const data = await requestJson(new URL("me", BASE_URL), config, fetcher);
  const parsed = z.object({ company: z.object({ name: z.string().min(1) }) }).safeParse(data);
  if (!parsed.success) throw new Error("PENNYLANE_ME_RESPONSE_INVALID");
  const name = parsed.data.company.name;
  if (name.normalize("NFKC").trim().toLocaleLowerCase("fr") !==
      config.expectedCompany.normalize("NFKC").trim().toLocaleLowerCase("fr")) {
    throw new Error("PENNYLANE_COMPANY_MISMATCH");
  }
  return name;
}

export async function listPennylaneResource(
  resource: PennylaneResource,
  config: PennylaneConfig,
  fetcher: PennylaneFetcher = fetch,
): Promise<PennylaneItem[]> {
  const result = new Map<string, PennylaneItem>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const url = new URL(resource, BASE_URL);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const body = await requestJson(url, config, fetcher);
    const parsed = pageSchema.safeParse(body);
    if (!parsed.success) throw new Error("PENNYLANE_PAGE_INVALID");
    const page = parsed.data;
    for (const item of page.items) {
      const id = String(item.id);
      if (!id.trim()) throw new Error("PENNYLANE_ITEM_ID_INVALID");
      result.set(id, item); // repeated record across pages is imported once
      if (result.size > MAX_RECORDS) throw new Error("PENNYLANE_RECORD_LIMIT");
    }
    if (!page.has_more) return [...result.values()];
    const next = page.next_cursor;
    if (!next || seenCursors.has(next)) throw new Error("PENNYLANE_CURSOR_INVALID");
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("PENNYLANE_PAGE_LIMIT");
}
