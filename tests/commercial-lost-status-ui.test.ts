import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("../src/components/commercial-workspace.tsx", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/app/api/desktop/commercial/route.ts", import.meta.url),
  "utf8",
);

describe("commercial lost status in the direct status editor", () => {
  it("offers Perdu and Abandonné in the status selector", () => {
    const editor = workspace.slice(
      workspace.indexOf("function StatusSection("),
      workspace.indexOf("function QuoteNotesSection("),
    );
    expect(editor).toContain('<option value="LOST">Perdu</option>');
    expect(editor).toContain('<option value="ABANDONED">Abandonné</option>');
  });

  it("routes closed statuses through the close mutation and shows a reason field", () => {
    const editor = workspace.slice(
      workspace.indexOf("function StatusSection("),
      workspace.indexOf("function QuoteNotesSection("),
    );
    expect(editor).toContain('if (target === "LOST" || target === "ABANDONED")');
    expect(editor).toContain('action: "close", caseId: item.id, status: target');
    expect(editor).toContain('action: "setStatus"');
    expect(editor).toContain("value={closingReason}");
    expect(editor).toContain("Classer comme perdu");
  });

  it("rejects closure of an affaire with an uncancelled chantier", () => {
    expect(route).toContain("function closureRequested");
    expect(route).toContain("createChantiersRepository().load()");
    expect(route).toContain("site.sourceCommercialCaseId === closingCaseId");
    expect(route).toContain('site.status !== "CANCELLED"');
    expect(route).toContain("COMMERCIAL_ACTIVE_CHANTIER_CANNOT_CLOSE_AS_LOST");
  });

  it("clears commercial potential planning for any closure action", () => {
    expect(route).toContain('input.action === "close"');
    expect(route).toContain("clearPlanningProvisionForCommercialCase");
  });
});
