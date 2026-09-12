import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../relay/worker";

const env = {
  NEXTCLOUD_BASE_URL: "https://nextcloud.example.test",
  NEXTCLOUD_LOGIN: "relay-test",
  NEXTCLOUD_APP_PASSWORD: "not-a-real-secret",
  NEXTCLOUD_USER_ID: "Lulu",
  NEXTCLOUD_SYNC_ROOT: "PAPOT_SYNC",
  RELAY_ACCESS_TOKEN: "test-token",
  RELAY_ALLOWED_ORIGIN: "https://mobile.example.test",
};

const packageBody = JSON.stringify({
  package_id: "11111111-1111-4111-8111-111111111111",
  schema_version: 1,
  app_version: "0.1.0",
  operation: "capture.create",
  papot_user_id: "22222222-2222-4222-8222-222222222222",
  device_id: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-09-12T12:00:00+02:00",
  client_request_id: "44444444-4444-4444-8444-444444444444",
  payload: {
    name: "Test relais",
  },
  attachments: [],
  proof: {
    algorithm: "Ed25519",
    key_id: "test-key",
    signature: "placeholder-signature",
  },
});

function relayRequest(body = packageBody, headers: Record<string, string> = {}): Request {
  return new Request("https://relay.example.test/v1/sync/packages", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      Origin: "https://mobile.example.test",
      ...headers,
    },
    body,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PAPOT relay worker", () => {
  it("rejects an unknown route", async () => {
    const response = await worker.fetch(new Request("https://relay.example.test/unknown"), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "NOT_FOUND",
    });
  });

  it("rejects an unauthorized upload without contacting Nextcloud", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = relayRequest(packageBody, {
      Authorization: "Bearer wrong-token",
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a browser origin that is not allowed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = relayRequest(packageBody, {
      Origin: "https://evil.example.test",
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid package envelope before contacting Nextcloud", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(relayRequest(JSON.stringify({ hello: "world" })), env);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads a valid finalized package with GET, PUT then MOVE", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(relayRequest(), env);

    expect(response.status).toBe(202);

    const body = (await response.json()) as {
      status: string;
      package_id: string;
      duplicate: boolean;
    };

    expect(body).toEqual({
      status: "ACCEPTED_FOR_PAPOT",
      package_id: "11111111-1111-4111-8111-111111111111",
      duplicate: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "MOVE" });
  });

  it("accepts an exact duplicate without rewriting it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(packageBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(relayRequest(), env);

    expect(response.status).toBe(202);

    const body = (await response.json()) as {
      duplicate: boolean;
    };

    expect(body.duplicate).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
