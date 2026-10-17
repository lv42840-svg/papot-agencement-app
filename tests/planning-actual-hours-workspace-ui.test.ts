import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/app/heures/page.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/actual-hours-workspace.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/desktop/planning/actual-hours/route.ts", import.meta.url), "utf8");
const chantiers = readFileSync(new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url), "utf8");
const nav = readFileSync(new URL("../src/lib/desktop/navigation.ts", import.meta.url), "utf8");

describe("actual hours interface and chantier bridge", () => {
  it("enables a dedicated Heures screen in the desktop shell", () => {
    expect(page).toContain("<DesktopAppShell>");
    expect(page).toContain("<ActualHoursWorkspace");
    expect(nav).toContain('href: "/heures"');
    expect(workspace).toContain("Saisie des heures réelles");
    expect(workspace).toContain('type="week"');
  });

  it("gives three manually editable activity fields per person and one atomic save", () => {
    expect(workspace).toContain('["BE", "WORKSHOP", "INSTALL"]');
    expect(workspace).toContain("data.people.map((person)");
    expect(workspace).toContain("Semaine écoulée");
    expect(workspace).toContain("Chantier");
    expect(workspace).toContain('action: "saveActualHoursRow"');
    expect(workspace).toContain("Enregistrer");
    expect(workspace).toContain("Prévu chantier");
    expect(workspace).toContain("Réalisé cumulé");
    expect(workspace).toContain("Reste à faire estimé");
  });

  it("requires the individual actual-hours permission on past weeks only", () => {
    expect(route).toContain('requireModuleRequestContext("planning", "WRITE")');
    expect(route).toContain('requireSpecialPermission(context.user, "planning.enter_actual_hours")');
    expect(route).toContain("if (!isPlanningWeekPast(input.week))");
    expect(route).toContain("applyActualHoursRow");
    expect(route).toContain("effectivePlanningPeople(payload, auth.users)");
    expect(route).toContain("Cache-Control");
  });

  it("projects real production into existing chantier summaries without writing to the chantier store", () => {
    expect(chantiers).toContain("realizedChantierIds");
    expect(chantiers).toContain("actualHoursByActivity");
    expect(chantiers).toContain("payload: viewPayload");
    expect(route).toContain("actualHoursByActivity");
  });
});
