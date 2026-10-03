import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyBootstrapToken } from "../src/lib/auth/bootstrap";

const previousToken = process.env.PAPOT_BOOTSTRAP_TOKEN;

afterEach(() => {
  if (previousToken === undefined) delete process.env.PAPOT_BOOTSTRAP_TOKEN;
  else process.env.PAPOT_BOOTSTRAP_TOKEN = previousToken;
});

describe("auth bootstrap token", () => {
  it("accepts the exact configured bootstrap token", () => {
    process.env.PAPOT_BOOTSTRAP_TOKEN = "12345678901234567890123456789012";

    expect(verifyBootstrapToken("12345678901234567890123456789012")).toBe(true);
  });

  it("rejects a wrong token", () => {
    process.env.PAPOT_BOOTSTRAP_TOKEN = "12345678901234567890123456789012";

    expect(verifyBootstrapToken("wrong-token")).toBe(false);
  });

  it("rejects missing, short or placeholder secrets", () => {
    delete process.env.PAPOT_BOOTSTRAP_TOKEN;
    expect(verifyBootstrapToken("anything")).toBe(false);

    process.env.PAPOT_BOOTSTRAP_TOKEN = "too-short";
    expect(verifyBootstrapToken("too-short")).toBe(false);

    process.env.PAPOT_BOOTSTRAP_TOKEN = "CHANGE_ME_LONG_RANDOM_SECRET";
    expect(verifyBootstrapToken("CHANGE_ME_LONG_RANDOM_SECRET")).toBe(false);
  });
});
