import { describe, expect, it } from "vitest";
import { describeSharedResourceAccess } from "../src/lib/sync/resource-access-presentation";

describe("shared resource access presentation", () => {
  it("shows editable state with the opened version", () => {
    expect(describeSharedResourceAccess({ status: "editable", version: 12 })).toEqual({
      canEdit: true,
      heading: "Modification autorisée",
      detail: "Vous avez la main sur cet élément.",
      versionLabel: "Version 12",
    });
  });

  it("shows the lock owner in read-only mode", () => {
    const result = describeSharedResourceAccess({
      status: "read-only",
      version: 13,
      ownerDisplayName: "Nadia",
    });

    expect(result.canEdit).toBe(false);
    expect(result.heading).toBe("Lecture seule");
    expect(result.detail).toBe("Nadia modifie actuellement cet élément.");
    expect(result.versionLabel).toBe("Version 13");
  });

  it("uses a safe fallback when the lock owner name is unavailable", () => {
    expect(describeSharedResourceAccess({ status: "read-only", version: 2 }).detail).toBe(
      "Un autre utilisateur modifie actuellement cet élément.",
    );
  });

  it("labels version zero as a new resource", () => {
    expect(describeSharedResourceAccess({ status: "editable", version: 0 }).versionLabel).toBe(
      "Nouveau",
    );
  });

  it("refuses an invalid resource version", () => {
    expect(() => describeSharedResourceAccess({ status: "editable", version: -1 })).toThrow(
      "RESOURCE_VERSION_INVALID",
    );
  });
});
