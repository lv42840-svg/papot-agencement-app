import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

describe("password hashing", () => {
  it("accepts the original password and rejects another", async () => {
    const hash = await hashPassword("a-strong-test-password");
    expect(await verifyPassword("a-strong-test-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
