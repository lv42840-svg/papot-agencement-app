import { describe, expect, it } from "vitest";
import { desktopNavigation } from "../src/lib/desktop/navigation";

describe("desktop navigation", () => {
  it("exposes Devis as the single top-level quotes entry", () => {
    const quoteEntries = desktopNavigation.filter((item) => item.moduleKey === "quotes");

    expect(quoteEntries).toEqual([
      expect.objectContaining({ label: "Devis", href: "/devis", moduleKey: "quotes" }),
    ]);
    expect(desktopNavigation.some((item) => item.label === "Bibliothèque")).toBe(false);
  });

  it("exposes one Planning entry instead of separate grand and petit planning entries", () => {
    const planningEntries = desktopNavigation.filter((item) => item.moduleKey === "planning");

    expect(planningEntries).toEqual([
      expect.objectContaining({ label: "Planning", href: "/planning/2026-S38" }),
    ]);
    expect(desktopNavigation.some((item) => item.label === "Grand planning")).toBe(false);
    expect(desktopNavigation.some((item) => item.label === "Petit planning")).toBe(false);
  });
});
