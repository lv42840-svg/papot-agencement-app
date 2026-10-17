import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homepage = readFileSync(new URL("../src/app/desktop-ready/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../src/components/dashboard-sold-margin-stat.tsx", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/app/api/desktop/dashboard/sold-summary/route.ts", import.meta.url),
  "utf8",
);

describe("dashboard financial preview", () => {
  it("replaces fictitious hours by transparent monthly annual sales and planned margin", () => {
    expect(homepage).toContain("<DashboardSoldMarginStat />");
    expect(homepage).not.toContain("<span>Heures saisies</span>");
    expect(panel).toContain("Vendu &amp; rentabilité");
    expect(panel).toContain("Marge prévue");
    expect(panel).toContain("pas CA facturé");
    expect(panel).toContain("Marge réelle en attente des achats");
  });

  it("enforces private pilotage and quote access server side", () => {
    expect(route).toContain('requireModuleRequestContext("pilotage", "READ")');
    expect(route).toContain('"dashboard.view_global"');
    expect(route).toContain('requireModuleRequestContext("commercial", "READ")');
    expect(route).toContain('requireModuleRequestContext("quotes", "READ")');
    expect(route).toContain("Cache-Control");
    expect(panel).toContain("/api/desktop/dashboard/sold-summary");
  });
});
