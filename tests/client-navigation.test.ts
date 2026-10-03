import { describe, expect, it } from "vitest";
import {
  clientWorkspaceHref,
  resolveClientWorkspaceSelection,
} from "../src/lib/clients/navigation";

describe("client workspace navigation", () => {
  it("builds the direct Clients workspace route", () => {
    expect(clientWorkspaceHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/clients?focus=11111111-1111-4111-8111-111111111111",
    );
  });

  it("gives priority to the requested client", () => {
    expect(
      resolveClientWorkspaceSelection(
        [
          { id: "client-a", isArchived: false },
          { id: "client-b", isArchived: false },
        ],
        "client-b",
        "client-a",
      ),
    ).toEqual({ selectedId: "client-b", revealArchived: false });
  });

  it("reveals an archived client when it is explicitly requested", () => {
    expect(
      resolveClientWorkspaceSelection(
        [
          { id: "client-a", isArchived: false },
          { id: "client-b", isArchived: true },
        ],
        "client-b",
        null,
      ),
    ).toEqual({ selectedId: "client-b", revealArchived: true });
  });
});
