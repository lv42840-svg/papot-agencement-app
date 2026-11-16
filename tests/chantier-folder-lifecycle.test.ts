import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ServerFileStore } from "../src/lib/server-files/storage";
import {
  commercialStorageFolder,
  chantierStorageFolder,
  prepareChantierFolder,
} from "../src/lib/chantiers/folder-lifecycle";
import type { CommercialCase } from "../src/lib/commercial/domain";
import type { ChantierRecord } from "../src/lib/chantiers/domain";
import { applyFolderTemplateAction, defaultFolderTemplate } from "../src/lib/chantiers/folder-template";

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

  it("creates BE and Devis structure and moves historical devis into the correct place", async () => {
    const files = await store();
    const source = commercialStorageFolder(affair);
    const previousPdf = `${source}/Devis/devis-2025.pdf`;
    await files.writeBytes(previousPdf, Buffer.from("old quote"));
    const business = {
      ...affair,
      documents: [{ storagePath: previousPdf, sha256: undefined }],
    } as unknown as CommercialCase;
    const prepared = await prepareChantierFolder(files, business, chantier, [business]);
    expect(prepared.remap(previousPdf)).toBe(
      `${prepared.path}/Devis-Chiffrage/Devis/devis-2025.pdf`,
    );
    expect(await files.readBytes(prepared.remap(previousPdf))).toEqual(Buffer.from("old quote"));
    expect(await files.directoryExists(`${prepared.path}/BE - Atelier/TOP`)).toBe(true);
    expect(await files.directoryExists(`${prepared.path}/BE - Atelier/Programme CN`)).toBe(true);
    expect(await files.directoryExists(`${prepared.path}/Documents chantier/Plans`)).toBe(true);
    expect(await files.directoryExists(`${prepared.path}/Pose`)).toBe(true);
  });

  it("respects an administrator-renamed Devis folder when moving older commercial files", async () => {
    const files = await store();
    const initial = defaultFolderTemplate();
    const devis = initial.folders.find((item) => item.name === "Devis")!;
    const changed = applyFolderTemplateAction(initial, {
      action: "rename", id: devis.id, name: "Offres clients",
    });
    const configRoot = path.join(files.rootPath, "_papot_settings");
    await mkdir(configRoot, { recursive: true });
    await writeFile(path.join(configRoot, "chantier-folder-template.json"), JSON.stringify(changed));

    const previousPdf = commercialStorageFolder(affair) + "/Devis/offre.pdf";
    await files.writeBytes(previousPdf, Buffer.from("devis conservé"));
    const business = {
      ...affair,
      documents: [{ storagePath: previousPdf }],
    } as unknown as CommercialCase;
    const prepared = await prepareChantierFolder(files, business, chantier, [business]);
    const expected = prepared.path + "/Devis-Chiffrage/Offres clients/offre.pdf";
    expect(prepared.remap(previousPdf)).toBe(expected);
    expect(await files.readBytes(expected)).toEqual(Buffer.from("devis conservé"));
    expect(await files.directoryExists(prepared.path + "/Devis-Chiffrage/Offres clients")).toBe(true);
  });

  it("is repeatable after a first repair without recreating or erasing files", async () => {
    const files = await store();
    const first = await prepareChantierFolder(files, affair, chantier, [affair]);
    await files.writeBytes(`${first.path}/BE - Atelier/DXF/plan.dxf`, Buffer.from("DXF"));
    await prepareChantierFolder(files, affair, chantier, [affair]);
    expect(await files.readBytes(`${first.path}/BE - Atelier/DXF/plan.dxf`)).toEqual(
      Buffer.from("DXF"),
    );
  });

  it("moves archived chantiers into the Archive branch without losing their technical files", async () => {
    const files = await store();
    const active = chantierStorageFolder(chantier);
    await files.writeBytes(`${active}/BE - Atelier/TOP/top.pdf`, Buffer.from("TOP"));
    const archived = { ...chantier, status: "ARCHIVED" as const };
    const prepared = await prepareChantierFolder(files, affair, archived, [affair]);
    expect(prepared.path).toContain("Chantier/2026/Archive/");
    expect(await files.readBytes(`${prepared.path}/BE - Atelier/TOP/top.pdf`)).toEqual(
      Buffer.from("TOP"),
    );
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
    const shared = {
      ...affair,
      id: "33333333-3333-4333-8333-333333333333",
      documents: [{ storagePath: `${source}/Devis/other.pdf` }],
    } as CommercialCase;
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
