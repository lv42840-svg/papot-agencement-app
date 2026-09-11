import { describe, expect, it } from "vitest";
import { captureCreateSchema } from "../src/lib/capture/schema";

const uuid = "7afad6ab-4372-4f7e-88fa-dc1feff2a9ba";

describe("captureCreateSchema", () => {
  it("accepts the minimal current capture payload", () => {
    const result = captureCreateSchema.safeParse({
      clientRequestId: uuid,
      title: "Client Dupont - entrée magasin",
      responsibleUserId: uuid,
      priority: "NORMAL",
      dueAt: null,
      tagIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("refuses an empty title", () => {
    const result = captureCreateSchema.safeParse({
      clientRequestId: uuid,
      title: "   ",
      responsibleUserId: uuid,
      priority: "NORMAL",
      tagIds: [],
    });
    expect(result.success).toBe(false);
  });
});
