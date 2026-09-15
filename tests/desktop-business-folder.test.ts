import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  resolveBusinessFolderPath,
}: {
  resolveBusinessFolderPath: (
    rootPath: string,
    input: { kind: string; caseId: string; creationYear: number },
  ) => string;
} = require("../desktop/business-folder.cjs");

const CASE_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("desktop business folder", () => {
  it("resolves a commercial affair folder under the configured file root", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        caseId: CASE_ID,
        creationYear: 2026,
      }),
    ).toBe(path.join(root, "documents", "commercial", "2026", CASE_ID));
  });

  it("rejects an unsupported business folder kind", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "arbitrary-path",
        caseId: CASE_ID,
        creationYear: 2026,
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");
  });

  it("rejects an invalid affair identifier", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        caseId: "../../Windows",
        creationYear: 2026,
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");
  });

  it("rejects an invalid creation year", () => {
    const root = path.resolve("/tmp/papot-business-files");

    expect(() =>
      resolveBusinessFolderPath(root, {
        kind: "commercial-case",
        caseId: CASE_ID,
        creationYear: 1999,
      }),
    ).toThrow("DESKTOP_BUSINESS_FOLDER_INVALID");
  });
});
