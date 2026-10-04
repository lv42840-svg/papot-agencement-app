import { describe, expect, it } from "vitest";
import {
  buildQuoteEmailMessage,
  DEFAULT_QUOTE_CC_EMAIL,
  DEFAULT_QUOTE_FROM_EMAIL,
  DEFAULT_QUOTE_REPLY_TO_EMAIL,
  quoteEmailPolicyFromEnv,
} from "../src/lib/quotes/email";

describe("quote transactional email", () => {
  it("uses PAPOT noreply with contact copied and as reply-to", () => {
    const policy = quoteEmailPolicyFromEnv({});
    expect(policy).toEqual({
      fromEmail: DEFAULT_QUOTE_FROM_EMAIL,
      ccEmail: DEFAULT_QUOTE_CC_EMAIL,
      replyToEmail: DEFAULT_QUOTE_REPLY_TO_EMAIL,
    });
    expect(policy.fromEmail).toBe("noreply@papot.eu");
    expect(policy.ccEmail).toBe("contact@papot.eu");
    expect(policy.replyToEmail).toBe("contact@papot.eu");
  });

  it("builds a PDF email with the customer and contact copy in the envelope", () => {
    const message = buildQuoteEmailMessage({
      to: "client@example.com",
      recipientName: "Mme Client",
      quoteNumber: "D-2026-0042",
      affairName: "Accueil mairie",
      quoteSubject: "Agencement accueil",
      pdfFileName: "Devis D-2026-0042.pdf",
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    });

    expect(message.envelopeFrom).toBe("noreply@papot.eu");
    expect(message.recipients).toEqual(["client@example.com", "contact@papot.eu"]);
    expect(message.raw).toContain("From: PAPOT AGENCEMENT <noreply@papot.eu>");
    expect(message.raw).toContain("To: client@example.com");
    expect(message.raw).toContain("Cc: contact@papot.eu");
    expect(message.raw).toContain("Reply-To: contact@papot.eu");
    expect(message.raw).toContain("Content-Type: application/pdf");
  });

  it("refuses to send without a customer email", () => {
    expect(() =>
      buildQuoteEmailMessage({
        to: "",
        recipientName: "",
        quoteNumber: "D-2026-0042",
        affairName: "Accueil mairie",
        quoteSubject: "Agencement accueil",
        pdfFileName: "devis.pdf",
        pdfBytes: new Uint8Array([1]),
      }),
    ).toThrow("QUOTE_RECIPIENT_EMAIL_REQUIRED");
  });
});
