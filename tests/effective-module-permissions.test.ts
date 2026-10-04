import { describe, expect, it } from "vitest";
import { effectiveModulePermissions } from "../src/lib/auth/effective-module-permissions";

describe("effective module permissions", () => {
  it("activates Devis for an existing administrator missing the quotes key", () => {
    expect(
      effectiveModulePermissions({
        canManagePermissions: true,
        modulePermissions: { commercial: "WRITE" },
      }),
    ).toEqual({
      commercial: "WRITE",
      quotes: "WRITE",
    });
  });

  it("does not grant Devis automatically to a non-admin user", () => {
    expect(
      effectiveModulePermissions({
        canManagePermissions: false,
        modulePermissions: { commercial: "WRITE" },
      }),
    ).toEqual({
      commercial: "WRITE",
    });
  });

  it("keeps an explicit Devis permission unchanged", () => {
    expect(
      effectiveModulePermissions({
        canManagePermissions: true,
        modulePermissions: { quotes: "READ" },
      }),
    ).toEqual({
      quotes: "READ",
    });
  });
});
