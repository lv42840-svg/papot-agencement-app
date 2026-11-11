import "server-only";

import { timingSafeEqual } from "node:crypto";

const PLACEHOLDER_PREFIX = "CHANGE_ME";

export function verifyBootstrapToken(tokenFourni: string): boolean {
  const tokenAttendu = process.env.PAPOT_BOOTSTRAP_TOKEN?.trim() ?? "";
  if (
    tokenAttendu.length < 24 ||
    tokenAttendu.startsWith(PLACEHOLDER_PREFIX) ||
    tokenFourni.length === 0
  ) {
    return false;
  }

  const octetsAttendus = Buffer.from(tokenAttendu);
  const octetsFournis = Buffer.from(tokenFourni);
  if (octetsAttendus.length !== octetsFournis.length) return false;

  return timingSafeEqual(octetsAttendus, octetsFournis);
}
