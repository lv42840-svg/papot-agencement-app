import { describe, expect, it } from "vitest";
import { desktopNavigation } from "../src/lib/desktop/navigation";
import { MODULE_PERMISSIONS } from "../src/lib/auth/permission-catalog";

describe("desktop navigation", () => {
  it("exposes Devis as the single top-level quotes entry", () => {
    const quoteEntries = desktopNavigation.filter((item) => item.moduleKey === "quotes");

    expect(quoteEntries).toEqual([
      expect.objectContaining({ label: "Devis", href: "/devis", moduleKey: "quotes" }),
    ]);
    expect(desktopNavigation.some((item) => item.label === "Bibliothèque")).toBe(false);
  });

  it("treats Devis as an active module instead of a prepared future module", () => {
    const quotesPermission = MODULE_PERMISSIONS.find((item) => item.key === "quotes");

    expect(quotesPermission).toEqual({
      key: "quotes",
      label: "Devis / Chiffrage",
    });
  });


  it("exposes one Planning entry instead of separate grand and petit planning entries", () => {
    const planningEntries = desktopNavigation.filter((item) => item.moduleKey === "planning");

    expect(planningEntries).toEqual([
      expect.objectContaining({ label: "Planning", href: "/planning" }),
    ]);
    expect(desktopNavigation.some((item) => item.label === "Grand planning")).toBe(false);
    expect(desktopNavigation.some((item) => item.label === "Petit planning")).toBe(false);
  });
});
