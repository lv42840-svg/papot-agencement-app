import { describe, expect, it } from "vitest";
import {
  commercialQuoteDisplayStatus,
  quoteEditorHref,
} from "../src/lib/commercial/quote-follow-up";

describe("commercial quote follow-up", () => {
  it("keeps a draft as Brouillon even when a follow-up date is past", () => {
    expect(
      commercialQuoteDisplayStatus("DRAFT", "2026-09-10", new Date("2026-09-14T12:00:00+02:00")),
    ).toBe("DRAFT");
  });

  it("shows a sent quote as Envoyé before its own follow-up date", () => {
    expect(
      commercialQuoteDisplayStatus("SENT", "2026-09-20", new Date("2026-09-14T12:00:00+02:00")),
    ).toBe("SENT");
  });

  it("shows a sent quote as À relancer when its own follow-up date is reached", () => {
    expect(
      commercialQuoteDisplayStatus("SENT", "2026-09-14", new Date("2026-09-14T12:00:00+02:00")),
    ).toBe("FOLLOW_UP");
  });

  it("keeps two sent quotes independent by using each quote follow-up date", () => {
    const now = new Date("2026-09-14T12:00:00+02:00");
    expect(commercialQuoteDisplayStatus("SENT", "2026-09-10", now)).toBe("FOLLOW_UP");
    expect(commercialQuoteDisplayStatus("SENT", "2026-09-20", now)).toBe("SENT");
  });

  it("builds the direct Devis editor route", () => {
    expect(quoteEditorHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/devis/11111111-1111-4111-8111-111111111111",
    );
  });
});
