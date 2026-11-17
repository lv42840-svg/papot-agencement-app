import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("../src/components/commercial-workspace.tsx", import.meta.url),
  "utf8",
);
const workspaceV2 = readFileSync(
  new URL("../src/components/commercial-workspace-v2.tsx", import.meta.url),
  "utf8",
);
const domain = readFileSync(
  new URL("../src/lib/commercial/domain.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/app/api/desktop/commercial/route.ts", import.meta.url),
  "utf8",
);

describe("commercial lost status in the direct status editor", () => {
  it("propose Perdu seulement dans l'ancien sélecteur, sans Abandonné", () => {
    const editor = workspace.slice(
      workspace.indexOf("function StatusSection("),
      workspace.indexOf("function QuoteNotesSection("),
    );
    expect(editor).toContain('<option value="LOST">Perdu</option>');
    expect(editor).not.toContain('<option value="ABANDONED">');
    expect(workspace).not.toContain("status: \"ABANDONED\", reason");
  });

  it("propose Perdu dans les deux menus de la V2 réellement utilisée", () => {
    const options = domain.slice(
      domain.indexOf("export const COMMERCIAL_FOLLOW_STATUS_OPTIONS"),
      domain.indexOf("export const COMMERCIAL_DOCUMENT_CATEGORY_LABELS"),
    );
    expect(options).toContain('"LOST"');
    expect(options).not.toContain('"ABANDONED"');
    expect(workspaceV2).toContain('COMMERCIAL_FOLLOW_STATUS_OPTIONS.map((value)');
    expect(workspaceV2.match(/COMMERCIAL_FOLLOW_STATUS_OPTIONS\\.map\\(\\(value\\)/g)).toHaveLength(2);
    expect(workspaceV2).toContain('if (status === "LOST")');
    expect(workspaceV2).toContain('action: "close"');
    expect(workspaceV2).toContain("Motif de perte (facultatif)");
    expect(workspaceV2).toContain('closingReason: nextStatus === "LOST" ? closingReason : undefined');
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
