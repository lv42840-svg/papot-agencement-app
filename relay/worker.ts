import { RelayNextcloudClient } from "./nextcloud-client";

type RelayEnv = {
  NEXTCLOUD_BASE_URL: string;
  NEXTCLOUD_LOGIN: string;
  NEXTCLOUD_APP_PASSWORD: string;
  NEXTCLOUD_USER_ID: string;
  NEXTCLOUD_SYNC_ROOT?: string;

  // Technical gate only. Device enrollment will replace this before production.
  RELAY_ACCESS_TOKEN: string;
  RELAY_ALLOWED_ORIGIN?: string;
};

const MAX_PACKAGE_BYTES = 256 * 1024;
const ACK_ROUTE_PREFIX = "/v1/sync/acks/";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(
  status: number,
  value: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);

  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function originHeaders(request: Request, env: RelayEnv): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};

  const allowedOrigin = env.RELAY_ALLOWED_ORIGIN?.trim();

  if (!allowedOrigin || origin !== allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  };
}

function isOriginAllowed(request: Request, env: RelayEnv): boolean {
  const origin = request.headers.get("Origin");

  if (!origin) return true;

  const allowedOrigin = env.RELAY_ALLOWED_ORIGIN?.trim();

  return Boolean(allowedOrigin && origin === allowedOrigin);
}

function hasRequiredConfig(env: RelayEnv): boolean {
  return [
    env.NEXTCLOUD_BASE_URL,
    env.NEXTCLOUD_LOGIN,
    env.NEXTCLOUD_APP_PASSWORD,
    env.NEXTCLOUD_USER_ID,
    env.RELAY_ACCESS_TOKEN,
  ].every((value) => typeof value === "string" && value.trim().length > 0);
}
function isAuthorized(request: Request, env: RelayEnv): boolean {
  const accessToken = env.RELAY_ACCESS_TOKEN?.trim();
  if (!accessToken) return false;

  const authorization = request.headers.get("Authorization") ?? "";
  return secureEqual(authorization, `Bearer ${accessToken}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextcloudClient(env: RelayEnv): RelayNextcloudClient {
  return new RelayNextcloudClient({
    baseUrl: env.NEXTCLOUD_BASE_URL,
    login: env.NEXTCLOUD_LOGIN,
    appPassword: env.NEXTCLOUD_APP_PASSWORD,
    userId: env.NEXTCLOUD_USER_ID,
    syncRoot: env.NEXTCLOUD_SYNC_ROOT,
  });
}

function parseEnvelope(raw: string): {
  packageId: string;
  papotUserId: string;
  deviceId: string;
} | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  if (value.schema_version !== 1) return null;
  if (value.operation !== "capture.create") return null;

  if (typeof value.package_id !== "string" || !UUID_RE.test(value.package_id)) {
    return null;
  }

  if (typeof value.papot_user_id !== "string" || !UUID_RE.test(value.papot_user_id)) {
    return null;
  }

  if (typeof value.device_id !== "string" || !UUID_RE.test(value.device_id)) {
    return null;
  }

  if (typeof value.client_request_id !== "string" || !UUID_RE.test(value.client_request_id)) {
    return null;
  }

  if (typeof value.app_version !== "string" || !value.app_version.trim()) {
    return null;
  }

  if (typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at))) {
    return null;
  }

  if (!isRecord(value.proof)) return null;
  if (value.proof.algorithm !== "Ed25519") return null;

  if (typeof value.proof.key_id !== "string" || value.proof.key_id.length < 1) {
    return null;
  }

  if (typeof value.proof.signature !== "string" || value.proof.signature.length < 1) {
    return null;
  }

  return {
    packageId: value.package_id,
    papotUserId: value.papot_user_id,
    deviceId: value.device_id,
  };
}

function parseAckPath(pathname: string): {
  papotUserId: string;
  deviceId: string;
  packageId: string;
} | null {
  if (!pathname.startsWith(ACK_ROUTE_PREFIX)) return null;

  const segments = pathname.slice(ACK_ROUTE_PREFIX.length).split("/");
  if (segments.length !== 3) return null;

  const [papotUserId, deviceId, packageId] = segments;
  if (!UUID_RE.test(papotUserId) || !UUID_RE.test(deviceId) || !UUID_RE.test(packageId)) {
    return null;
  }

  return { papotUserId, deviceId, packageId };
}

async function acceptedResponse(
  packageId: string,
  duplicate: boolean,
  headers: Record<string, string>,
): Promise<Response> {
  return jsonResponse(
    202,
    {
      status: "ACCEPTED_FOR_PAPOT",
      package_id: packageId,
      duplicate,
    },
    headers,
  );
}

async function handleUpload(request: Request, env: RelayEnv): Promise<Response> {
  const corsHeaders = originHeaders(request, env);

  if (!isOriginAllowed(request, env)) {
    return jsonResponse(403, { error: "ORIGIN_NOT_ALLOWED" });
  }

  if (!isAuthorized(request, env)) {
    return jsonResponse(401, { error: "UNAUTHORIZED" }, corsHeaders);
  }

  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    return jsonResponse(415, { error: "JSON_REQUIRED" }, corsHeaders);
  }

  const announcedLength = Number(request.headers.get("Content-Length") ?? 0);

  if (Number.isFinite(announcedLength) && announcedLength > MAX_PACKAGE_BYTES) {
    return jsonResponse(413, { error: "PACKAGE_TOO_LARGE" }, corsHeaders);
  }

  const raw = await request.text();

  if (new TextEncoder().encode(raw).length > MAX_PACKAGE_BYTES) {
    return jsonResponse(413, { error: "PACKAGE_TOO_LARGE" }, corsHeaders);
  }

  const envelope = parseEnvelope(raw);

  if (!envelope) {
    return jsonResponse(400, { error: "INVALID_PACKAGE_ENVELOPE" }, corsHeaders);
  }

  const nextcloud = nextcloudClient(env);

  const incomingUrl = nextcloud.deviceZoneUrl(envelope.papotUserId, envelope.deviceId, "incoming");
  const packageUrl = nextcloud.childUrl(incomingUrl, `${envelope.packageId}.json`);

  const existing = await nextcloud.getText(packageUrl);

  if (existing !== null) {
    if (existing !== raw) {
      return jsonResponse(409, { error: "PACKAGE_ID_CONFLICT" }, corsHeaders);
    }

    return acceptedResponse(envelope.packageId, true, corsHeaders);
  }

  try {
    await nextcloud.putFinalizedJson(packageUrl, raw);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NEXTCLOUD_WRITE_FAILED";

    if (code === "NEXTCLOUD_MOVE_HTTP_412") {
      const racedExisting = await nextcloud.getText(packageUrl);

      if (racedExisting === raw) {
        return acceptedResponse(envelope.packageId, true, corsHeaders);
      }

      return jsonResponse(409, { error: "PACKAGE_ID_CONFLICT" }, corsHeaders);
    }

    return jsonResponse(
      502,
      {
        error: "UPSTREAM_WRITE_FAILED",
        code,
      },
      corsHeaders,
    );
  }

  return acceptedResponse(envelope.packageId, false, corsHeaders);
}

async function handleAckRead(
  request: Request,
  env: RelayEnv,
  target: { papotUserId: string; deviceId: string; packageId: string },
): Promise<Response> {
  const corsHeaders = originHeaders(request, env);

  if (!isOriginAllowed(request, env)) {
    return jsonResponse(403, { error: "ORIGIN_NOT_ALLOWED" });
  }

  if (!isAuthorized(request, env)) {
    return jsonResponse(401, { error: "UNAUTHORIZED" }, corsHeaders);
  }

  const nextcloud = nextcloudClient(env);
  const ackUrl = nextcloud.deviceZoneUrl(target.papotUserId, target.deviceId, "ack");
  const ackFileUrl = nextcloud.childUrl(ackUrl, `${target.packageId}.json`);

  let raw: string | null;
  try {
    raw = await nextcloud.getText(ackFileUrl);
  } catch (error) {
    const code = error instanceof Error ? error.message : "NEXTCLOUD_READ_FAILED";
    return jsonResponse(502, { error: "UPSTREAM_READ_FAILED", code }, corsHeaders);
  }

  if (raw === null) {
    return jsonResponse(
      404,
      {
        status: "ACK_NOT_READY",
        package_id: target.packageId,
      },
      corsHeaders,
    );
  }

  let ack: unknown;
  try {
    ack = JSON.parse(raw);
  } catch {
    return jsonResponse(502, { error: "UPSTREAM_ACK_INVALID" }, corsHeaders);
  }

  if (!isRecord(ack) || ack.package_id !== target.packageId) {
    return jsonResponse(502, { error: "UPSTREAM_ACK_INVALID" }, corsHeaders);
  }

  return jsonResponse(200, ack, corsHeaders);
}

function handleOptions(request: Request, env: RelayEnv, methods: string): Response {
  if (!isOriginAllowed(request, env)) {
    return jsonResponse(403, { error: "ORIGIN_NOT_ALLOWED" });
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...originHeaders(request, env),
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
    },
  });
}

const worker = {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    if (!hasRequiredConfig(env)) {
      return jsonResponse(503, { error: "RELAY_NOT_CONFIGURED" });
    }

    const url = new URL(request.url);

    if (url.pathname === "/v1/sync/packages") {
      if (request.method === "OPTIONS") {
        return handleOptions(request, env, "POST, OPTIONS");
      }

      if (request.method !== "POST") {
        return jsonResponse(
          405,
          { error: "METHOD_NOT_ALLOWED" },
          {
            Allow: "POST, OPTIONS",
            ...originHeaders(request, env),
          },
        );
      }

      return handleUpload(request, env);
    }

    if (url.pathname.startsWith(ACK_ROUTE_PREFIX)) {
      if (request.method === "OPTIONS") {
        return handleOptions(request, env, "GET, OPTIONS");
      }

      if (request.method !== "GET") {
        return jsonResponse(
          405,
          { error: "METHOD_NOT_ALLOWED" },
          {
            Allow: "GET, OPTIONS",
            ...originHeaders(request, env),
          },
        );
      }

      const target = parseAckPath(url.pathname);
      if (!target) {
        return jsonResponse(400, { error: "INVALID_ACK_PATH" }, originHeaders(request, env));
      }

      return handleAckRead(request, env, target);
    }

    return jsonResponse(404, { error: "NOT_FOUND" });
  },
};

export default worker;
