import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("Electron packaging", () => {
  it("keeps production dependencies out of the Electron shell bundle", () => {
    const productionDependencies = Object.keys(packageJson.dependencies ?? {}).sort();
    const ignoredProductionDependencies = [
      ...(packageJson.build.ignoredProductionDependencies ?? []),
    ].sort();

    expect(ignoredProductionDependencies).toEqual(productionDependencies);
  });
});
