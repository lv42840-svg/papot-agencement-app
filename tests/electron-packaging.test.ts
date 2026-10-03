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

  it("bundles the Word V2 quote template as an external runtime resource", () => {
    expect(packageJson.build.extraResources).toContainEqual({
      from: "docs/templates/PAPOT_Template_Devis_V2.docx",
      to: "quote-templates/PAPOT_Template_Devis_V2.docx",
    });
  });
});
