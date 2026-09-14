import { describe, expect, it } from "vitest";
import {
  commercialQuoteDisplayStatus,
  quoteEditorHref,
} from "../src/lib/commercial/quote-follow-up";
import type { CommercialCase } from "../src/lib/commercial/domain";

function affair(overrides: Partial<Pick<CommercialCase, "status" | "reviewDate">> = {}) {
  return {
    status: "WAITING" as const,
    reviewDate: "2026-09-20",
    ...overrides,
  };
}

describe("commercial quote follow-up", () => {
  it("keeps a draft as Brouillon even when the affair needs a follow-up", () => {
    expect(
      commercialQuoteDisplayStatus(
        "DRAFT",
        affair({ status: "FOLLOW_UP", reviewDate: "2026-09-10" }),
        new Date("2026-09-14T12:00:00+02:00"),
      ),
    ).toBe("DRAFT");
  });

  it("shows a sent quote as Envoyé before its follow-up date", () => {
    expect(
      commercialQuoteDisplayStatus(
        "SENT",
        affair({ status: "WAITING", reviewDate: "2026-09-20" }),
        new Date("2026-09-14T12:00:00+02:00"),
      ),
    ).toBe("SENT");
  });

  it("shows a sent quote as À relancer when the affair reached its follow-up date", () => {
    expect(
      commercialQuoteDisplayStatus(
        "SENT",
        affair({ status: "WAITING", reviewDate: "2026-09-14" }),
        new Date("2026-09-14T12:00:00+02:00"),
      ),
    ).toBe("FOLLOW_UP");
  });

  it("shows a sent quote as À relancer when the affair is already in follow-up", () => {
    expect(
      commercialQuoteDisplayStatus(
        "SENT",
        affair({ status: "FOLLOW_UP", reviewDate: null }),
        new Date("2026-09-14T12:00:00+02:00"),
      ),
    ).toBe("FOLLOW_UP");
  });

  it("builds the direct Devis editor route", () => {
    expect(quoteEditorHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/devis/11111111-1111-4111-8111-111111111111",
    );
  });
});
