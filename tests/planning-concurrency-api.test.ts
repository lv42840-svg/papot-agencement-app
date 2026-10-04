import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);

describe("planning concurrency API", () => {
  it("requires and rechecks the displayed planning revision before every mutation", () => {
    expect(routeSource).toContain('"PLANNING_VERSION_REQUIRED"');
    expect(routeSource).toContain('"PLANNING_VERSION_CONFLICT"');
    expect(routeSource).toContain("if ((await planningRevision(payload)) !== expectedRevision)");
    expect(routeSource).toContain("planningRepository.mutate");
  });
});
