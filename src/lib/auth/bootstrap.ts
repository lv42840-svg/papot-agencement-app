import "server-only";

import { timingSafeEqual } from "node:crypto";

const PLACEHOLDER_PREFIX = "CHANGE_ME";

export function verifyBootstrapToken(provided: string): boolean {
  const expected = process.env.PAPOT_BOOTSTRAP_TOKEN?.trim() ?? "";
  if (expected.length < 24 || expected.startsWith(PLACEHOLDER_PREFIX) || provided.length === 0) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;

  return timingSafeEqual(expectedBytes, providedBytes);
}
