import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  resolveBusinessFilePath,
  resolveBusinessFolderPath,
}: {
  resolveBusinessFilePath: (
    rootPath: string,
    input: { kind: string; storagePath: string },
  ) => string;
  resolveBusinessFolderPath: (
    rootPath: string,
    input: { kind: string; storagePath: string },
  ) => string;
} = require("../desktop/business-folder.cjs");

describe("desktop business folder", () => {
  it("resolves a readable commercial affair folder from a stored document path", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        storagePath: "Commercial/2026/Dupont_Cuisine Lyon/Documents reçus/plan client.pdf",
      }),
    ).toBe(path.join(root, "Commercial", "2026", "Dupont_Cuisine Lyon"));
  });

  it("resolves the exact commercial document without copying it", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(
      resolveBusinessFilePath(root, {
        kind: "commercial-document",
        storagePath: "Commercial/2026/Dupont_Cuisine Lyon/Documents reçus/plan client.pdf",
      }),
    ).toBe(
      path.join(
        root,
        "Commercial",
        "2026",
        "Dupont_Cuisine Lyon",
        "Documents reçus",
        "plan client.pdf",
      ),
    );
  });

  it("rejects an unsupported business folder kind", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "arbitrary-path",
        storagePath: "Commercial/2026/Dupont_Cuisine/Devis/devis.pdf",
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");
  });

  it("rejects an unsupported business file kind", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFilePath(root, {
        kind: "arbitrary-path",
        storagePath: "Commercial/2026/Dupont_Cuisine/Devis/devis.pdf",
      }),
    ).toThrow("DESKTOP_BUSINESS_FILE_INVALID");
  });

  it("rejects a path traversal", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        storagePath: "Commercial/2026/../../Windows/system.ini",
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");

    expect(() =>
      resolveBusinessFilePath(root, {
        kind: "commercial-document",
        storagePath: "Commercial/2026/../../Windows/system.ini",
      }),
    ).toThrow("DESKTOP_BUSINESS_FILE_INVALID");
  });

  it("rejects a document outside the commercial storage branch", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        storagePath: "Chantier/2026/Dupont_Cuisine/Plans/plan.pdf",
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");

    expect(() =>
      resolveBusinessFilePath(root, {
        kind: "commercial-document",
        storagePath: "Chantier/2026/Dupont_Cuisine/Plans/plan.pdf",
      }),
    ).toThrow("DESKTOP_BUSINESS_FILE_INVALID");
  });

  it("rejects the obsolete technical commercial folder layout", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        storagePath:
          "documents/commercial/2026/123e4567-e89b-12d3-a456-426614174000/quote/id/devis.pdf",
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");
  });
});
