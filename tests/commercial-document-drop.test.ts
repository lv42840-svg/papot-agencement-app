import { describe, expect, it } from "vitest";
import { collectDroppedFiles } from "../src/lib/commercial/document-drop";

describe("commercial document drop", () => {
  it("collects only file items from a drop", () => {
    const first = { name: "plan.pdf" };
    const second = { name: "photo.jpg" };

    expect(
      collectDroppedFiles(
        [
          { kind: "file", getAsFile: () => first },
          { kind: "string", getAsFile: () => ({ name: "ignore.txt" }) },
          { kind: "file", getAsFile: () => second },
        ],
        [],
      ),
    ).toEqual([first, second]);
  });

  it("ignores null file items", () => {
    const file = { name: "mesure.xlsx" };

    expect(
      collectDroppedFiles(
        [
          { kind: "file", getAsFile: () => null },
          { kind: "file", getAsFile: () => file },
        ],
        [],
      ),
    ).toEqual([file]);
  });

  it("falls back to the dropped FileList when items do not expose files", () => {
    const fallback = [{ name: "croquis.png" }, { name: "note.txt" }];

    expect(collectDroppedFiles([{ kind: "string", getAsFile: () => null }], fallback)).toEqual(
      fallback,
    );
  });
});
