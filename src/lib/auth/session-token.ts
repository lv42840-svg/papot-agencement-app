import { createHash, randomBytes } from "node:crypto";

export function newSessionToken() {
  const configured = Number(
    process.env.PAPOT_SESSION_TTL_HOURS ?? process.env.SESSION_TTL_HOURS ?? 12,
  );
  const hours =
    Number.isInteger(configured) && configured >= 1 && configured <= 168 ? configured : 12;
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + hours * 60 * 60 * 1000),
  };
}
