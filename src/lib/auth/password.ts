import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(motDePasse: string): Promise<string> {
  const sel = randomBytes(16).toString("hex");
  const derive = (await scrypt(motDePasse, sel, KEY_LENGTH)) as Buffer;
  return `scrypt$${sel}$${derive.toString("hex")}`;
}

export async function verifyPassword(motDePasse: string, valeurStockee: string): Promise<boolean> {
  const [algorithme, sel, valeurEncodee] = valeurStockee.split("$");
  if (algorithme !== "scrypt" || !sel || !valeurEncodee) return false;

  const valeurAttendue = Buffer.from(valeurEncodee, "hex");
  if (valeurAttendue.length === 0) return false;
  const valeurCalculee = (await scrypt(motDePasse, sel, valeurAttendue.length)) as Buffer;
  return (
    valeurAttendue.length === valeurCalculee.length &&
    timingSafeEqual(valeurAttendue, valeurCalculee)
  );
}
