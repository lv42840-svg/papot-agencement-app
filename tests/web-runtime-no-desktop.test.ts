import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopApiRoot = fileURLToPath(new URL("../src/app/api/desktop", import.meta.url));
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

describe("web runtime isolation from desktop runtime", () => {
  it("keeps every web-used desktop-prefixed API route free of DesktopRequestContext", () => {
    for (const file of routeFiles(desktopApiRoot)) {
      const routePath = relative(desktopApiRoot, file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf-8");
      expect(source, routePath).not.toContain("requireDesktopRequestContext");
      expect(source, routePath).not.toContain("createDesktopSharedResourceRuntime");
    }
  });

  it("redirects the legacy weekly planning page to the PostgreSQL web planning", () => {
    const source = readFileSync(
      new URL("../src/app/planning/[weekId]/page.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain('redirect(year ? `/planning?year=${year}` : "/planning")');
    expect(source).not.toContain("PlanningWeekEditor");
    expect(source).not.toContain("useSharedResourceEditor");
  });
});
