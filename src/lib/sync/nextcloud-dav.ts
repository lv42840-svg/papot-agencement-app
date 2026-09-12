import { randomUUID } from "node:crypto";

function joinUrl(base: string, ...parts: string[]): string {
  return [base.replace(/\/+$/, ""), ...parts.map((part) => part.replace(/^\/+|\/+$/g, ""))].join(
    "/",
  );
}

function basicAuth(login: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${login}:${appPassword}`, "utf8").toString("base64")}`;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractDavEtag(xml: string): string | null {
  const match = xml.match(
    /<(?:[A-Za-z][A-Za-z0-9_-]*:)?getetag(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z][A-Za-z0-9_-]*:)?getetag>/i,
  );
  if (!match) return null;
  const etag = decodeXmlText(match[1].trim());
  return etag || null;
}

export type NextcloudDavConfig = {
  baseUrl: string;
  login: string;
  appPassword: string;
  userAgent?: string;
};

export type ConditionalWriteResult = "written" | "precondition-failed";
export type ConditionalDeleteResult = "deleted" | "missing" | "precondition-failed";

export type TextWithEtag = {
  text: string;
  etag: string;
};

export class NextcloudDavClient {
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly userAgent: string;
  private readonly ensuredCollections = new Map<string, Promise<void>>();

  constructor(config: NextcloudDavConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authorization = basicAuth(config.login, config.appPassword);
    this.userAgent = config.userAgent ?? "PAPOT-Sync-Worker/0.1";
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: this.authorization,
      "User-Agent": this.userAgent,
      ...extra,
    };
  }

  private async request(
    method: string,
    url: string,
    expected: number[],
    options?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const response = await fetch(url, {
      method,
      headers: this.headers(options?.headers),
      body: options?.body,
    });
    if (!expected.includes(response.status)) {
      throw new Error(`WEBDAV_${method}_HTTP_${response.status}`);
    }
    return response;
  }

  async discoverUserId(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/ocs/v1.php/cloud/user?format=json`, {
      headers: this.headers({
        "OCS-APIRequest": "true",
        Accept: "application/json",
      }),
    });
    if (!response.ok) throw new Error(`NEXTCLOUD_USER_DISCOVERY_HTTP_${response.status}`);

    const body = (await response.json()) as { ocs?: { data?: { id?: unknown } } };
    const userId = body.ocs?.data?.id;
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("NEXTCLOUD_USER_DISCOVERY_INVALID");
    }
    return userId;
  }

  filesRoot(userId: string): string {
    return joinUrl(this.baseUrl, "remote.php/dav/files", encodeURIComponent(userId));
  }

  childUrl(parentUrl: string, childName: string): string {
    return joinUrl(parentUrl, encodeURIComponent(childName));
  }

  async exists(url: string): Promise<boolean> {
    const response = await fetch(url, {
      method: "PROPFIND",
      headers: this.headers({ Depth: "0" }),
    });
    if (response.status === 207) return true;
    if (response.status === 404) return false;
    throw new Error(`WEBDAV_PROPFIND_HTTP_${response.status}`);
  }

  async ensureCollection(url: string): Promise<void> {
    const normalizedUrl = url.replace(/\/+$/, "");
    const existing = this.ensuredCollections.get(normalizedUrl);
    if (existing) return existing;

    const verification = (async () => {
      if (await this.exists(`${normalizedUrl}/`)) return;
      await this.request("MKCOL", normalizedUrl, [201]);
    })();
    this.ensuredCollections.set(normalizedUrl, verification);

    try {
      await verification;
    } catch (error) {
      this.ensuredCollections.delete(normalizedUrl);
      throw error;
    }
  }

  async ensurePath(rootUrl: string, segments: string[]): Promise<string> {
    let current = rootUrl;
    for (const segment of segments) {
      current = this.childUrl(current, segment);
      await this.ensureCollection(current);
    }
    return current;
  }

  async listNames(collectionUrl: string): Promise<string[]> {
    const response = await this.request("PROPFIND", `${collectionUrl.replace(/\/+$/, "")}/`, [207], {
      headers: { Depth: "1" },
    });
    const xml = await response.text();
    const hrefs = [...xml.matchAll(/<(?:[A-Za-z]+:)?href>([\s\S]*?)<\/(?:[A-Za-z]+:)?href>/gi)]
      .map((match) => decodeXmlText(match[1].trim()))
      .map((href) => {
        try {
          return new URL(href, this.baseUrl).pathname.replace(/\/+$/, "");
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    const collectionPath = new URL(`${collectionUrl.replace(/\/+$/, "")}/`).pathname.replace(/\/+$/, "");
    const names = new Set<string>();
    for (const pathname of hrefs) {
      if (pathname === collectionPath) continue;
      const parent = pathname.slice(0, pathname.lastIndexOf("/"));
      if (parent !== collectionPath) continue;
      const rawName = pathname.slice(pathname.lastIndexOf("/") + 1);
      if (!rawName) continue;
      try {
        names.add(decodeURIComponent(rawName));
      } catch {
        throw new Error("WEBDAV_INVALID_CHILD_NAME");
      }
    }
    return [...names].sort();
  }

  async getText(url: string): Promise<string> {
    return (await this.request("GET", url, [200])).text();
  }

  private async getDavEtag(url: string): Promise<string | null> {
    const response = await fetch(url, {
      method: "PROPFIND",
      headers: this.headers({
        Depth: "0",
        "Content-Type": "application/xml; charset=utf-8",
      }),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
    });

    if (response.status === 404) return null;
    if (response.status !== 207) throw new Error(`WEBDAV_PROPFIND_HTTP_${response.status}`);

    const etag = extractDavEtag(await response.text());
    if (!etag) throw new Error("WEBDAV_PROPFIND_ETAG_MISSING");
    return etag;
  }

  async getTextWithEtag(url: string): Promise<TextWithEtag | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeEtag = await this.getDavEtag(url);
      if (beforeEtag === null) return null;

      const response = await fetch(url, {
        method: "GET",
        headers: this.headers({ "Cache-Control": "no-cache" }),
      });

      if (response.status === 404) continue;
      if (response.status !== 200) throw new Error(`WEBDAV_GET_HTTP_${response.status}`);
      const text = await response.text();

      const afterEtag = await this.getDavEtag(url);
      if (afterEtag === null) continue;
      if (beforeEtag === afterEtag) {
        return { text, etag: afterEtag };
      }
    }

    throw new Error("WEBDAV_READ_UNSTABLE");
  }

  async getBytes(url: string): Promise<Buffer> {
    const response = await this.request("GET", url, [200]);
    return Buffer.from(await response.arrayBuffer());
  }

  async putText(url: string, body: string): Promise<void> {
    await this.request("PUT", url, [201, 204], {
      body,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  async putTextIfAbsent(url: string, body: string): Promise<ConditionalWriteResult> {
    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers({
        "Content-Type": "application/json; charset=utf-8",
        "If-None-Match": "*",
      }),
      body,
    });

    if (response.status === 201 || response.status === 204) return "written";
    if (response.status === 412) return "precondition-failed";
    throw new Error(`WEBDAV_PUT_HTTP_${response.status}`);
  }

  async putTextIfMatch(url: string, body: string, etag: string): Promise<ConditionalWriteResult> {
    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers({
        "Content-Type": "application/json; charset=utf-8",
        "If-Match": etag,
      }),
      body,
    });

    if (response.status === 201 || response.status === 204) return "written";
    if (response.status === 412) return "precondition-failed";
    throw new Error(`WEBDAV_PUT_HTTP_${response.status}`);
  }

  async move(sourceUrl: string, destinationUrl: string, overwrite: boolean): Promise<void> {
    await this.request("MOVE", sourceUrl, [201, 204], {
      headers: {
        Destination: destinationUrl,
        Overwrite: overwrite ? "T" : "F",
      },
    });
  }

  async delete(url: string, allowMissing = false): Promise<void> {
    await this.request("DELETE", url, allowMissing ? [204, 404] : [204]);
  }

  async deleteIfMatch(url: string, etag: string): Promise<ConditionalDeleteResult> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers({ "If-Match": etag }),
    });

    if (response.status === 204) return "deleted";
    if (response.status === 404) return "missing";
    if (response.status === 412) return "precondition-failed";
    throw new Error(`WEBDAV_DELETE_HTTP_${response.status}`);
  }

  async putFinalizedJson(finalUrl: string, body: string, overwrite = true): Promise<void> {
    const stagingUrl = `${finalUrl}.staging-${randomUUID()}`;
    try {
      await this.putText(stagingUrl, body);
      await this.move(stagingUrl, finalUrl, overwrite);
    } catch (error) {
      await this.delete(stagingUrl, true).catch(() => undefined);
      throw error;
    }
  }
}
