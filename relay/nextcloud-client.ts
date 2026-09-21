export type RelayNextcloudConfig = {
  baseUrl: string;
  login: string;
  appPassword: string;
  userId: string;
  syncRoot?: string;
};

function joinUrl(base: string, ...parts: string[]): string {
  return [base.replace(/\/+$/, ""), ...parts.map((part) => part.replace(/^\/+|\/+$/g, ""))].join(
    "/",
  );
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class RelayNextcloudClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly userId: string;
  private readonly syncRoot: string;

  constructor(config: RelayNextcloudConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authorization = `Basic ${utf8Base64(`${config.login}:${config.appPassword}`)}`;
    this.userId = config.userId;
    this.syncRoot = config.syncRoot?.trim() || "PAPOT_SYNC";
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: this.authorization,
      ...extra,
    };
  }

  private async request(
    method: string,
    url: string,
    expectedStatuses: number[],
    options?: { body?: BodyInit; headers?: Record<string, string> },
  ): Promise<Response> {
    const response = await fetch(url, {
      method,
      headers: this.headers(options?.headers),
      body: options?.body,
    });

    if (!expectedStatuses.includes(response.status)) {
      throw new Error(`NEXTCLOUD_${method}_HTTP_${response.status}`);
    }

    return response;
  }

  private filesRoot(): string {
    return joinUrl(
      this.baseUrl,
      "remote.php/dav/files",
      encodeURIComponent(this.userId),
      encodeURIComponent(this.syncRoot),
    );
  }

  deviceZoneUrl(
    papotUserId: string,
    deviceId: string,
    zone: "incoming" | "ack" | "error" | "outgoing" | "snapshot",
  ): string {
    return joinUrl(
      this.filesRoot(),
      "users",
      encodeURIComponent(papotUserId),
      "devices",
      encodeURIComponent(deviceId),
      zone,
    );
  }

  childUrl(parentUrl: string, childName: string): string {
    return joinUrl(parentUrl, encodeURIComponent(childName));
  }

  async getText(url: string): Promise<string | null> {
    const response = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });

    if (response.status === 404) return null;
    if (response.status !== 200) {
      throw new Error(`NEXTCLOUD_GET_HTTP_${response.status}`);
    }

    return response.text();
  }

  async putFinalizedJson(finalUrl: string, body: string): Promise<void> {
    const stagingUrl = `${finalUrl}.staging-${crypto.randomUUID()}`;

    try {
      await this.request("PUT", stagingUrl, [201, 204], {
        body,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
      await this.request("MOVE", stagingUrl, [201, 204], {
        headers: {
          Destination: finalUrl,
          Overwrite: "F",
        },
      });
    } catch (error) {
      await fetch(stagingUrl, {
        method: "DELETE",
        headers: this.headers(),
      }).catch(() => undefined);
      throw error;
    }
  }
}
