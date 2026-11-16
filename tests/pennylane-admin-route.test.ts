import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user-admin", () => ({
  requirePermissionAdministrator: vi.fn(),
  userAdminErrorStatus: (code: string) => code === "ADMIN_FORBIDDEN" ? 403 : 401,
}));
vi.mock("@/lib/pennylane/connection", () => ({
  getPennylaneConnectionOverview: vi.fn(),
  savePennylaneConnection: vi.fn(),
  readPennylaneStoredConfig: vi.fn(),
  recordPennylaneConnectionTest: vi.fn(),
  removePennylaneConnection: vi.fn(),
}));
vi.mock("@/lib/pennylane/client", () => ({ probePennylaneAccess: vi.fn() }));

import { GET, POST } from "../src/app/api/admin/pennylane/route";
import { requirePermissionAdministrator } from "../src/lib/auth/user-admin";
import {
  getPennylaneConnectionOverview,
  savePennylaneConnection,
  readPennylaneStoredConfig,
  recordPennylaneConnectionTest,
  removePennylaneConnection,
} from "../src/lib/pennylane/connection";
import { probePennylaneAccess } from "../src/lib/pennylane/client";

const secret = "fake-pennylane-private-admin-test-token";
const overview = {
  configured: true, encryptionReady: true, syncEnabled: false,
  expectedCompany: "PAPOT LIBERAL", updatedAt: "2026-11-16T12:00:00Z",
  lastTestedAt: null, lastTest: null,
};

function request(action: unknown, origin = "https://agencement.papot.app") {
  return new Request("https://agencement.papot.app/api/admin/pennylane", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "agencement.papot.app",
      origin,
    },
    body: JSON.stringify(action),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissionAdministrator).mockResolvedValue({} as never);
  vi.mocked(getPennylaneConnectionOverview).mockResolvedValue(overview);
  vi.mocked(readPennylaneStoredConfig).mockResolvedValue({
    expectedCompany: "PAPOT LIBERAL", token: secret,
  });
});

describe("Pennylane admin settings API", () => {
  it("denies unauthorized admin requests before reading or saving any secret", async () => {
    vi.mocked(requirePermissionAdministrator).mockRejectedValueOnce(new Error("ADMIN_FORBIDDEN"));
    const response = await POST(request({ action: "SAVE", token: secret, expectedCompany: "PAPOT LIBERAL" }));
    expect(response.status).toBe(403);
    expect(savePennylaneConnection).not.toHaveBeenCalled();
  });

  it("denies cross-site writes even with an authenticated administrator", async () => {
    const response = await POST(request({ action: "SAVE", token: secret, expectedCompany: "PAPOT LIBERAL" }, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(savePennylaneConnection).not.toHaveBeenCalled();
  });

  it("never sends the saved token back in GET or POST responses", async () => {
    const post = await POST(request({ action: "SAVE", token: secret, expectedCompany: "PAPOT LIBERAL" }));
    expect(post.status).toBe(200);
    expect(savePennylaneConnection).toHaveBeenCalledWith(secret, "PAPOT LIBERAL");
    expect(await post.text()).not.toContain(secret);
    const get = await GET();
    expect(get.status).toBe(200);
    const body = await get.text();
    expect(body).toContain("configured");
    expect(body).not.toContain(secret);
    expect(get.headers.get("cache-control")).toContain("no-store");
  });

  it("tests access with the stored key but returns only safe status labels", async () => {
    const probe = {
      companyName: "PAPOT LIBERAL",
      access: {
        suppliers: "allowed", supplier_invoices: "forbidden",
        customers: "allowed", customer_invoices: "forbidden",
      },
    } as const;
    vi.mocked(probePennylaneAccess).mockResolvedValue(probe);
    const response = await POST(request({ action: "TEST" }));
    expect(response.status).toBe(200);
    expect(probePennylaneAccess).toHaveBeenCalledWith({
      token: secret, expectedCompany: "PAPOT LIBERAL",
    });
    expect(recordPennylaneConnectionTest).toHaveBeenCalledWith(probe);
    const body = await response.text();
    expect(body).toContain("forbidden");
    expect(body).not.toContain(secret);
  });

  it("allows explicit removal without returning the secret", async () => {
    const response = await POST(request({ action: "REMOVE" }));
    expect(response.status).toBe(200);
    expect(removePennylaneConnection).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain(secret);
  });

  it("rejects unknown actions, extra fields and plaintext-style invalid credentials", async () => {
    for (const payload of [
      { action: "SYNC" },
      { action: "TEST", token: secret },
      { action: "SAVE", token: "short", expectedCompany: "PAPOT LIBERAL" },
    ]) {
      const response = await POST(request(payload));
      expect(response.status).toBe(400);
    }
    expect(savePennylaneConnection).not.toHaveBeenCalled();
  });
});
