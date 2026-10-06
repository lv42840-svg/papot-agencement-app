import { describe, expect, it } from "vitest";

import { parseAuthPayload } from "../src/lib/auth/domain";
import {
  emptyLoginState,
  failedLogin,
  loginBlock,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from "../src/lib/auth/login-policy";

function legacyUser(id: string, email: string) {
  return {
    id,
    displayName: email.split("@")[0] || "Utilisateur",
    email,
    passwordHash: "scrypt$salt$00",
    isActive: true,
    canManagePermissions: false,
    mustChangePassword: false,
    accentKey: "lavender",
    modulePermissions: {},
    specialPermissions: [],
  };
}

describe("Concept-style Agencement authentication", () => {
  it("derives stable unique usernames for legacy e-mail accounts", () => {
    const payload = parseAuthPayload({
      schemaVersion: 1,
      users: [
        legacyUser("11111111-1111-4111-8111-111111111111", "lucien@papot.eu"),
        legacyUser("22222222-2222-4222-8222-222222222222", "lucien@example.fr"),
        legacyUser("33333333-3333-4333-8333-333333333333", "n@papot.eu"),
      ],
      sessions: [],
    });

    expect(payload.users.map((user) => user.username)).toEqual([
      "lucien",
      "lucien-2",
      "user-33333333",
    ]);
  });

  it("locks temporarily after repeated failures then requires an admin reset after a second cycle", () => {
    let state = emptyLoginState();
    const firstStart = Date.parse("2026-10-06T08:00:00.000Z");

    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      state = failedLogin(state, firstStart + index * 1000);
    }
    expect(loginBlock(state, firstStart + 10_000)).toBe("temporary");
    expect(state.requiresAdminReset).toBe(false);

    const secondStart = firstStart + LOGIN_WINDOW_MS + 1000;
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
      state = failedLogin(state, secondStart + index * 1000);
    }
    expect(state.requiresAdminReset).toBe(true);
    expect(loginBlock(state, secondStart + 10_000)).toBe("admin_reset_required");
  });
});
