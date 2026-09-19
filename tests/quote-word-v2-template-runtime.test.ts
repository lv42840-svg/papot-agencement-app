import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadQuoteWordV2Template,
  quoteWordV2TemplatePath,
} from "../src/lib/quotes/word-v2-template-runtime";

const roots: string[] = [];
const previousTemplatePath = process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE;

afterEach(async () => {
  if (previousTemplatePath === undefined) delete process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE;
  else process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE = previousTemplatePath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Word V2 quote template runtime", () => {
  it("loads the explicitly configured packaged template path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "papot-quote-template-"));
    roots.push(root);
    const templatePath = path.join(root, "PAPOT_Template_Devis_V2.docx");
    await writeFile(templatePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
    process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE = templatePath;

    expect(quoteWordV2TemplatePath()).toBe(templatePath);
    await expect(loadQuoteWordV2Template()).resolves.toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
    );
  });

  it("refuses a missing or non-DOCX runtime template", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "papot-quote-template-"));
    roots.push(root);
    const missingPath = path.join(root, "missing.docx");
    process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE = missingPath;
    await expect(loadQuoteWordV2Template()).rejects.toThrow("QUOTE_WORD_V2_TEMPLATE_UNAVAILABLE");

    const invalidPath = path.join(root, "invalid.docx");
    await writeFile(invalidPath, "invalid");
    process.env.PAPOT_QUOTE_WORD_V2_TEMPLATE = invalidPath;
    await expect(loadQuoteWordV2Template()).rejects.toThrow("QUOTE_WORD_V2_TEMPLATE_INVALID");
  });
});
