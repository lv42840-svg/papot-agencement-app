import { readFile } from "node:fs/promises";
import path from "node:path";

const TEMPLATE_FILE_NAME = "PAPOT_Template_Devis_V2.docx";

export function quoteWordV2TemplatePath(): string {
  const cheminConfigure = process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE?.trim();
  if (cheminConfigure) return path.resolve(cheminConfigure);
  return path.join(process.cwd(), "docs", "templates", TEMPLATE_FILE_NAME);
}

export async function loadQuoteWordV2Template(): Promise<Uint8Array> {
  let octets: Buffer;
  try {
    octets = await readFile(quoteWordV2TemplatePath());
  } catch {
    throw new Error("QUOTE_WORD_V2_TEMPLATE_UNAVAILABLE");
  }
  if (octets.length < 4 || octets[0] !== 0x50 || octets[1] !== 0x4b) {
    throw new Error("QUOTE_WORD_V2_TEMPLATE_INVALID");
  }
  return new Uint8Array(octets);
}
