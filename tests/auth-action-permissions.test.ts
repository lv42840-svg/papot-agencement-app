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

  it("requires confirmation permission for a complementary accepted quote", () => {
    expect(commercialSpecialPermissionForMutation({ action: "retainAdditionalQuote" })).toBe(
      "commercial.confirm_launch",
    );
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

  it("requires one shared permission to close and reopen a chantier", () => {
    expect(chantierSpecialPermissionForMutation({ action: "markDone" })).toBe(
      "chantiers.close_reopen",
    );
    expect(chantierSpecialPermissionForMutation({ action: "reactivate" })).toBe(
      "chantiers.close_reopen",
    );
  });
});

describe("permission catalog", () => {
  it("keeps Devis active while Facturation remains prepared", () => {
    const quotes = MODULE_PERMISSIONS.find((module) => module.key === "quotes");
    const billing = MODULE_PERMISSIONS.find((module) => module.key === "billing");

    expect(quotes).toEqual({
      key: "quotes",
      label: "Devis / Chiffrage",
    });
    expect(billing).toEqual(
      expect.objectContaining({ key: "billing", future: true }),
    );
  });

  it("contains the dedicated chantier lifecycle right", () => {
    expect(SPECIAL_PERMISSIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "chantiers.close_reopen",
          label: "Fermer / réouvrir un chantier",
          moduleKey: "chantiers",
        }),
      ]),
    );
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
