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

export type NextcloudDavConfig = {
  baseUrl: string;
  login: string;
  appPassword: string;
  userAgent?: string;
};

export class NextcloudDavClient {
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly userAgent: string;

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
    if (await this.exists(`${url.replace(/\/+$/, "")}/`)) return;
    await this.request("MKCOL", url, [201]);
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
