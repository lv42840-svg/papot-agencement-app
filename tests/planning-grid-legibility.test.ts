import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gridSource = readFileSync(
  new URL("../src/components/planning-excel-grid.tsx", import.meta.url),
  "utf-8",
);
const workspaceSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning compact grid legibility", () => {
  it("only displays firm and provisional availability above the activity totals", () => {
    const summaries = gridSource.split("const summaryRows:")[1].split("// Totaux de charge ferme")[0];
    expect(summaries).toContain("Disponible ferme");
    expect(summaries).toContain("Disponible avec potentiel");
    expect(summaries).not.toContain("Capacité totale");
    expect(summaries).not.toContain("Charge ferme");
    expect(summaries).not.toContain("Charge potentielle");
    expect(gridSource).toContain("excelActivityTotalRow");
  });

  it("leaves enough room for three-digit inputs in weekly and metric subcolumns", () => {
    expect(workspaceSource).toContain("min-width: 150px;");
    expect(workspaceSource).toContain("width: 150px;");
    expect(workspaceSource).toContain("padding: 0 2px;");
    expect(workspaceSource).toContain("font-variant-numeric: tabular-nums;");
    expect(workspaceSource).toContain("min-height: 30px;");
    expect(workspaceSource).toContain("const stickyColumnsWidth = 655;");
  });
});
