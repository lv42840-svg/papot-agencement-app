import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const forbidden = /nextcloud|obat/i;
const roots = ["src", "desktop", "scripts", "relay", ".github", "tests", "deploy", "docs"];
const rootFiles = ["README.md", "package.json", "package-lock.json", ".env.example"];

function textFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) return textFiles(full);
    return /\.(?:ts|tsx|js|cjs|mjs|json|md|yml|yaml|txt)$/.test(name) ? [full] : [];
  });
}

describe("legacy integrations removed", () => {
  it("contains no legacy provider or estimator references in runtime/configuration code", () => {
    const files = [
      ...roots.flatMap((dir) => textFiles(join(root, dir))),
      ...rootFiles.map((name) => join(root, name)).filter(existsSync),
    ];

    const hits = files.flatMap((file) => {
      const repoPath = relative(root, file).replaceAll("\\", "/");
      if (repoPath === "tests/legacy-integrations-removed.test.ts") return [];
      const source = readFileSync(file, "utf-8");
      if (!forbidden.test(source) && !forbidden.test(repoPath)) return [];
      return [repoPath];
    });

    expect(hits).toEqual([]);
  });
});
