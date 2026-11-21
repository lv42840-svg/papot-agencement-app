import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("TEST labels in real workflows, without cleanup side effects", () => {
  it("uses an explicit checkbox at affair creation and propagates it to new records", () => {
    const ui = read("src/components/commercial-workspace-v2.tsx");
    const quoteApi = read("src/app/api/desktop/quotes/route.ts");
    const launch = read("src/lib/chantiers/mutations.ts");
    expect(ui).toContain('name="isTest"');
    expect(ui).toContain('isTest: form.get("isTest") === "on"');
    expect(quoteApi).toContain("affair.isTest === true");
    expect(launch).toContain("isTest: commercialCase.isTest === true");
  });

  it("can mark an existing affair, quote or chantier and filter each list", () => {
    const affair = read("src/components/commercial-workspace-v2.tsx");
    const quote = read("src/components/quote-direct-editor.tsx");
    const chantier = read("src/components/chantier-workspace.tsx");
    const affairList = read("src/components/commercial-workspace-v2.tsx");
    const quoteList = read("src/components/quotes-workspace.tsx");
    const chantierList = read("src/components/chantiers-workspace.tsx");
    expect(affair).toContain('action: "setTestMarker"');
    expect(affair).toContain("expectedUpdatedAt: item.updatedAt");
    expect(quote).toContain('action: "setTestMarker"');
    expect(quote).toContain("quoteRevisionHeaders(quote.updatedAt)");
    expect(chantier).toContain('action: "setTestMarker"');
    expect(affairList).toContain("showTestsOnly");
    expect(quoteList).toContain("showTestsOnly");
    expect(chantierList).toContain("showTestsOnly");
  });

  it("does not add any automatic delete, reset or registry-clearing endpoint", () => {
    const commercial = read("src/lib/commercial/mutations.ts");
    const quotes = read("src/lib/quotes/mutations.ts");
    const chantiers = read("src/lib/chantiers/mutations.ts");
    const toggle = read("src/components/test-data-marker.tsx");
    expect(commercial).toContain("TEST_MARKER_UPDATED");
    expect(chantiers).toContain("TEST_MARKER_UPDATED");
    expect(quotes).toContain('if (input.action === "setTestMarker")');
    expect(toggle).toContain("ne supprimera rien");
    expect(toggle).not.toContain("deleteDraft");
    expect(toggle).not.toContain("/api/desktop/billing/test-sandbox");
  });
});
