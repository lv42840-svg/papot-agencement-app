import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
import { GET } from "@/app/api/auth/identity/route";

describe("identity shared with SRV explorer", () => {
  beforeEach(() => getCurrentUser.mockReset());
  it("rejects absent/revoked sessions", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("rejects a mandatory password change", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", mustChangePassword: true });
    expect((await GET()).status).toBe(401);
  });
  it("only discloses minimal identity and forbids caching", async () => {
    getCurrentUser.mockResolvedValue({
      id: "u1",
      username: "lucien",
      displayName: "Lucien",
      email: "private@example.test",
      mustChangePassword: false,
      canManagePermissions: true,
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "u1", username: "lucien", displayName: "Lucien" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
