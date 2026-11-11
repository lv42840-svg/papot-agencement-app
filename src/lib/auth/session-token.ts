import { createHash, randomBytes } from "node:crypto";

export function newSessionToken() {
  const dureeConfiguree = Number(
    process.env.PAPOT_SESSION_TTL_HOURS ?? process.env.SESSION_TTL_HOURS ?? 12,
  );
  const dureeHeures =
    Number.isInteger(dureeConfiguree) &&
    dureeConfiguree >= 1 &&
    dureeConfiguree <= 168
      ? dureeConfiguree
      : 12;
  const jeton = randomBytes(32).toString("base64url");
  const dateCreation = new Date();
  return {
    token: jeton,
    tokenHash: createHash("sha256").update(jeton).digest("hex"),
    createdAt: dateCreation,
    expiresAt: new Date(dateCreation.getTime() + dureeHeures * 60 * 60 * 1000),
  };
}
