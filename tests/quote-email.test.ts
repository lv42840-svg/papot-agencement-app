import { describe, expect, it } from "vitest";
import {
  buildQuoteEmailMessage,
  DEFAULT_QUOTE_CC_EMAIL,
  DEFAULT_QUOTE_FROM_EMAIL,
  DEFAULT_QUOTE_REPLY_TO_EMAIL,
  quoteEmailPolicyFromEnv,
} from "../src/lib/quotes/email";
import {
  createDefaultQuoteEmailSettings,
  renderQuoteEmailTemplate,
} from "../src/lib/quote-email-settings/domain";

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

  it("builds a PDF email with edited content", () => {
    const policy = quoteEmailPolicyFromEnv({});
    const message = buildQuoteEmailMessage(
      {
        to: "client@example.com",
        subject: "Devis D-2026-0042 - Accueil mairie",
        body: "Bonjour Mme Client,\n\nVoici votre devis.",
        pdfFileName: "Devis D-2026-0042.pdf",
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      },
      policy,
    );

    expect(message.envelopeFrom).toBe("noreply@papot.eu");
    expect(message.recipients).toEqual(["client@example.com", "contact@papot.eu"]);
    expect(message.raw).toContain("From: PAPOT AGENCEMENT <noreply@papot.eu>");
    expect(message.raw).toContain("To: client@example.com");
    expect(message.raw).toContain("Cc: contact@papot.eu");
    expect(message.raw).toContain("Reply-To: contact@papot.eu");
    expect(message.raw).toContain("Content-Type: application/pdf");
  });

  it("renders the shared model with quote variables", () => {
    const settings = createDefaultQuoteEmailSettings();
    const subject = renderQuoteEmailTemplate(settings.subjectTemplate, {
      AFFAIRE: "Accueil mairie",
      BONJOUR: "Bonjour Mme Client,",
      CLIENT: "Mairie",
      CONTACT: "Mme Client",
      NUM_DEVIS: "D-2026-0042",
      OBJET_DEVIS: "Agencement accueil",
    });
    expect(subject).toBe("Devis D-2026-0042 - Accueil mairie");
  });

  it("refuses to send without a customer email", () => {
    expect(() =>
      buildQuoteEmailMessage(
        {
          to: "",
          subject: "Devis",
          body: "Bonjour",
          pdfFileName: "devis.pdf",
          pdfBytes: new Uint8Array([1]),
        },
        quoteEmailPolicyFromEnv({}),
      ),
    ).toThrow("QUOTE_RECIPIENT_EMAIL_REQUIRED");
  });
});
