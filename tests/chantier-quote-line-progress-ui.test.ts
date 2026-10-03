import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const operational = readFileSync(
  new URL("../src/components/chantier-operational-workspace.tsx", import.meta.url),
  "utf-8",
);
const route = readFileSync(
  new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url),
  "utf-8",
);

describe("chantier retained quote line checklist UI", () => {
  it("shows retained quote lines with a simple completion action", () => {
    expect(operational).toContain("setQuoteLineProgress");
    expect(operational).toContain("Marquer réalisée");
    expect(operational).toContain("Ligne remise à faire.");
    expect(operational).toContain("line.quantity");
    expect(operational).toContain("line.unit");
  });

  it("validates progress changes against a retained quote line on the server", () => {
    expect(route).toContain('input.action === "setQuoteLineProgress"');
    expect(route).toContain("resolveRetainedChantierQuoteLine");
    expect(route).toContain("chantierQuoteLineDisplay(reference)");
  });
});
