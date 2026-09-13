import { describe, expect, it } from "vitest";
import {
  chantierSpecialPermissionForMutation,
  commercialSpecialPermissionForMutation,
} from "../src/lib/auth/action-permissions";
import { MODULE_PERMISSIONS, SPECIAL_PERMISSIONS } from "../src/lib/auth/permission-catalog";

describe("commercial special permissions", () => {
  it("requires the create permission for a new commercial case", () => {
    expect(commercialSpecialPermissionForMutation({ action: "create" })).toBe("commercial.create");
  });

  it("requires the provision permission for capacity provisioning", () => {
    expect(commercialSpecialPermissionForMutation({ action: "updateProvision" })).toBe(
      "commercial.provision",
    );
  });

  it("requires confirmation permission when a case becomes confirmed", () => {
    expect(
      commercialSpecialPermissionForMutation({ action: "setStatus", status: "CONFIRMED" }),
    ).toBe("commercial.confirm_launch");
    expect(
      commercialSpecialPermissionForMutation({
        action: "recordFollowUp",
        nextStatus: "CONFIRMED",
      }),
    ).toBe("commercial.confirm_launch");
  });

  it("does not add a special permission to ordinary commercial modifications", () => {
    expect(
      commercialSpecialPermissionForMutation({ action: "setStatus", status: "WAITING" }),
    ).toBeNull();
    expect(commercialSpecialPermissionForMutation({ action: "update" })).toBeNull();
  });
});

describe("chantier special permissions", () => {
  it("requires the archive permission for archive and archived reactivation", () => {
    expect(chantierSpecialPermissionForMutation({ action: "archive" })).toBe(
      "chantiers.archive_reactivate",
    );
    expect(chantierSpecialPermissionForMutation({ action: "unarchive" })).toBe(
      "chantiers.archive_reactivate",
    );
  });

  it("keeps ordinary chantier lifecycle changes under module WRITE", () => {
    expect(chantierSpecialPermissionForMutation({ action: "markDone" })).toBeNull();
    expect(chantierSpecialPermissionForMutation({ action: "reactivate" })).toBeNull();
  });
});

describe("permission catalog", () => {
  it("activates Devis while keeping Facturation prepared", () => {
    const quotes = MODULE_PERMISSIONS.find((module) => module.key === "quotes");
    const billing = MODULE_PERMISSIONS.find((module) => module.key === "billing");

    expect(quotes).toEqual(expect.objectContaining({ key: "quotes" }));
    expect(quotes).not.toHaveProperty("future");
    expect(billing).toEqual(expect.objectContaining({ key: "billing", future: true }));
  });

  it("contains the validated planning special rights", () => {
    const keys = SPECIAL_PERMISSIONS.map((permission) => permission.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "planning.edit_macro",
        "planning.edit_daily",
        "planning.enter_actual_hours",
        "planning.manage_schedules",
      ]),
    );
  });
});
