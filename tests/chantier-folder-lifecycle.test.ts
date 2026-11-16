import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ServerFileStore } from "../src/lib/server-files/storage";
import { commercialStorageFolder, chantierStorageFolder, prepareChantierFolder } from "../src/lib/chantiers/folder-lifecycle";
import type { CommercialCase } from "../src/lib/commercial/domain";
import type { ChantierRecord } from "../src/lib/chantiers/domain";

const roots: string[] = [];
async function store() {
  const root = await mkdtemp(path.join(tmpdir(), "papot-chantier-folder-"));
  roots.push(root);
  return new ServerFileStore(root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const affair = {
  id: "22222222-2222-4222-8222-222222222222",
  createdAt: "2025-12-15T12:00:00.000Z",
  clientName: "CLIENT PAPOT",
  name: "Boutique Bourg",
  documents: [],
} as unknown as CommercialCase;
const chantier = {
  id: affair.id,
  launchYear: 2026,
  number: "2026-001",
  clientName: affair.clientName,
  name: affair.name,
} as ChantierRecord;

describe("chantier physical folder lifecycle", () => {
  it("creates a new chantier folder without needing uploaded documents", async () => {
    const files = await store();
    const prepared = await prepareChantierFolder(files, affair, chantier, [affair]);
    expect(prepared.path).toBe("Chantier/2026/2026-001 - CLIENT PAPOT_Boutique Bourg");
    expect(await files.directoryExists(prepared.path)).toBe(true);
  });

  it("moves existing documents and remaps references, and can roll back", async () => {
    const files = await store();
    const source = commercialStorageFolder(affair);
    const doc = `${source}/Devis/devis.pdf`;
    await files.writeBytes(doc, Buffer.from("PDF TEST"));
    const original = { ...affair, documents: [{ storagePath: doc }] } as CommercialCase;

    const prepared = await prepareChantierFolder(files, original, chantier, [original]);
    expect(await files.directoryExists(source)).toBe(false);
    expect(await files.readBytes(prepared.remap(doc))).toEqual(Buffer.from("PDF TEST"));
    await prepared.rollback();
    expect(await files.readBytes(doc)).toEqual(Buffer.from("PDF TEST"));
  });

  it("does not overwrite a chantier folder already occupied", async () => {
    const files = await store();
    const source = commercialStorageFolder(affair);
    const target = chantierStorageFolder(chantier);
    await files.ensureDirectory(source);
    await files.ensureDirectory(target);
    await expect(prepareChantierFolder(files, affair, chantier, [affair])).rejects.toThrow(
      "CHANTIER_DESTINATION_FOLDER_EXISTS",
    );
  });

  it("refuses to move a directory referenced by another commercial case", async () => {
    const files = await store();
    const source = commercialStorageFolder(affair);
    const shared = { ...affair, id: "33333333-3333-4333-8333-333333333333", documents: [{ storagePath: `${source}/Devis/other.pdf` }] } as CommercialCase;
    await files.ensureDirectory(source);
    await expect(prepareChantierFolder(files, affair, chantier, [affair, shared])).rejects.toThrow(
      "CHANTIER_SOURCE_FOLDER_SHARED",
    );
  });

  it("refuses traversal in physical storage paths", async () => {
    const files = await store();
    await expect(files.ensureDirectory("../outside")).rejects.toThrow("SERVER_FILE_PATH_INVALID");
    await expect(files.moveDirectory("../outside", "Chantier/2026/Test")).rejects.toThrow(
      "SERVER_FILE_PATH_INVALID",
    );
  });
});
