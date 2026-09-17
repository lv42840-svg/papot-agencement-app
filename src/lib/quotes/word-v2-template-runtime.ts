import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const TEMPLATE_FILE_NAME = "PAPOT_Template_Devis_V2.docx";

export function quoteWordV2TemplatePath(): string {
  const configured = process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "docs", "templates", TEMPLATE_FILE_NAME);
}

export async function loadQuoteWordV2Template(): Promise<Uint8Array> {
  let bytes: Buffer;
  try {
    bytes = await readFile(quoteWordV2TemplatePath());
  } catch {
    throw new Error("QUOTE_WORD_V2_TEMPLATE_UNAVAILABLE");
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("QUOTE_WORD_V2_TEMPLATE_INVALID");
  }
  return new Uint8Array(bytes);
}
