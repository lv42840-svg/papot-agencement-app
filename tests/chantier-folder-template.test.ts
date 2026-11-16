import { describe, expect, it } from "vitest";
import {
  applyFolderTemplateAction,
  canonicalFolderPath,
  defaultFolderTemplate,
  folderNodePath,
  folderTemplatePaths,
  validateFolderTemplate,
} from "../src/lib/chantiers/folder-template";

describe("configurable chantier directory template", () => {
  it("keeps all standard BE, devis and chantier folders in its initial template", () => {
    const template = defaultFolderTemplate();
    expect(folderTemplatePaths(template)).toContain("Devis-Chiffrage/Devis");
    expect(folderTemplatePaths(template)).toContain("BE - Atelier/TOP");
    expect(folderTemplatePaths(template)).toContain("Documents chantier/Plans");
    expect(folderTemplatePaths(template)).toContain("Pose");
    expect(folderTemplatePaths(template)).toContain("SAV");
  });

  it("renames a business folder without losing the canonical devis role", () => {
    const source = defaultFolderTemplate();
    const devisId = source.folders.find((folder) => folder.name === "Devis")!.id;
    const modified = applyFolderTemplateAction(source, {
      action: "rename",
      id: devisId,
      name: "Offres clients",
    });
    expect(canonicalFolderPath(modified, "Devis-Chiffrage/Devis")).toBe(
      "Devis-Chiffrage/Offres clients",
    );
    expect(modified.revision).toBe(source.revision + 1);
  });

  it("adds a custom child and then moves it under another branch", () => {
    const source = defaultFolderTemplate();
    const be = source.folders.find((folder) => folder.name === "BE - Atelier")!;
    const plans = source.folders.find((folder) => folder.name === "Documents chantier")!;
    const added = applyFolderTemplateAction(source, {
      action: "add",
      parentId: be.id,
      name: "Maquettes 3D",
    });
    const created = added.folders.find((folder) => folder.name === "Maquettes 3D")!;
    expect(folderNodePath(added, created.id)).toBe("BE - Atelier/Maquettes 3D");
    const moved = applyFolderTemplateAction(added, {
      action: "move",
      id: created.id,
      parentId: plans.id,
    });
    expect(folderNodePath(moved, created.id)).toBe("Documents chantier/Maquettes 3D");
  });

  it("rejects traversal names, Windows reserved names, duplicate siblings and cycles", () => {
    const source = defaultFolderTemplate();
    const be = source.folders.find((folder) => folder.name === "BE - Atelier")!;
    const top = source.folders.find((folder) => folder.name === "TOP")!;
    expect(() =>
      applyFolderTemplateAction(source, { action: "add", parentId: null, name: "../secret" }),
    ).toThrow("CHANTIER_TEMPLATE_NAME_INVALID");
    expect(() =>
      applyFolderTemplateAction(source, { action: "add", parentId: null, name: "CON" }),
    ).toThrow("CHANTIER_TEMPLATE_NAME_INVALID");
    expect(() =>
      applyFolderTemplateAction(source, { action: "add", parentId: be.id, name: "TOP" }),
    ).toThrow("CHANTIER_TEMPLATE_DUPLICATE_NAME");
    expect(() =>
      applyFolderTemplateAction(source, { action: "move", id: be.id, parentId: top.id }),
    ).toThrow("CHANTIER_TEMPLATE_CYCLE");
  });

  it("refuses to remove system folders from a submitted model", () => {
    const source = defaultFolderTemplate();
    expect(() => validateFolderTemplate({ ...source, folders: source.folders.slice(1) })).toThrow();
  });

  it("reorders siblings while keeping their ids and paths intact", () => {
    const source = defaultFolderTemplate();
    const be = source.folders.find((folder) => folder.name === "BE - Atelier")!;
    const top = source.folders.find((folder) => folder.name === "TOP")!;
    const changed = applyFolderTemplateAction(source, {
      action: "reorder",
      id: top.id,
      direction: "down",
    });
    const names = changed.folders
      .filter((item) => item.parentId === be.id)
      .map((item) => item.name);
    expect(names.slice(0, 2)).toEqual(["DFT", "TOP"]);
    expect(folderNodePath(changed, top.id)).toBe("BE - Atelier/TOP");
  });
});
