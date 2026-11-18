import { timingSafeEqual } from "node:crypto";

/**
 * Separate 256-bit cron secret, never the Pennylane API token or an admin session.
 * Fails closed if it has not been installed on the VPS.
 */
export function authorizedScheduledPennylaneRequest(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(authorization ?? "")?.[1];
  if (!token || !secret || !/^[a-f0-9]{64}$/i.test(secret)) return false;
  return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(secret, "hex"));
}
