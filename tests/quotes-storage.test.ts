import { describe, expect, it } from "vitest";
import { createInitialQuotesPayload } from "../src/lib/quotes/model";
import {
  applyQuotesMutation,
  quotesMutationSchema,
  type QuoteSendContext,
} from "../src/lib/quotes/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

const clientId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";
const sectionId = "55555555-5555-4555-8555-555555555555";
const lineId = "66666666-6666-4666-8666-666666666666";

const sendContext: QuoteSendContext = {
  clientSnapshot: {
    displayName: "PAPOT TEST",
    companyName: "PAPOT TEST",
    firstName: "",
    lastName: "",
    addressLine1: "1 rue du Test",
    addressLine2: "",
    postalCode: "42300",
    city: "Roanne",
    phone: "0400000000",
    email: "test@example.com",
    siret: "12345678901234",
    paymentTerms: "45 jours fin de mois",
  },
};

function createDraft(id = quoteId) {
  const input = quotesMutationSchema.parse({
    action: "create",
    quoteId: id,
    commercialCaseId: caseId,
    clientId,
    subject: "Agencement accueil",
    issueDate: "2026-09-13",
    paymentTerms: "45 jours fin de mois",
    items: [
      {
        id: sectionId,
        kind: "SECTION",
        title: "Mobilier",
        discountPercent: 5,
      },
      {
        id: lineId,
        kind: "LINE",
        parentId: sectionId,
        description: "Meuble sur mesure",
        unit: "m²",
        quantityInput: "2+6+4+9",
        unitPriceCents: 12_500,
        discountPercent: 10,
        vatRatePercent: 20,
      },
    ],
  });

  return applyQuotesMutation(
    createInitialQuotesPayload(),
    input,
    actor,
    new Date("2026-09-13T12:00:00.000Z"),
  ).payload;
}

describe("shared native quotes", () => {
  it("creates a draft and keeps the quantity formula", () => {
    const payload = createDraft();
    const quote = payload.quotes[0];
    expect(quote.status).toBe("DRAFT");
    expect(quote.quoteNumber).toBeNull();
    expect(quote.validUntil).toBe("2026-10-13");
    expect(quote.items[1]).toMatchObject({
      kind: "LINE",
      quantity: 21,
      quantityFormula: "2+6+4+9",
    });
  });

  it("creates idempotently when the caller reuses the same quote id", () => {
    const first = createDraft();
    const input = quotesMutationSchema.parse({
      action: "create",
      quoteId,
      clientId,
      subject: "Retry",
    });
    const retry = applyQuotesMutation(first, input, actor).payload;
    expect(retry.quotes).toHaveLength(1);
    expect(retry.quotes[0].subject).toBe("Agencement accueil");
  });

  it("rejects an invalid hierarchy", () => {
    const input = quotesMutationSchema.parse({
      action: "create",
      clientId,
      subject: "Hiérarchie invalide",
      items: [
        {
          kind: "SUBSECTION",
          parentId: lineId,
          title: "Sous-lot",
        },
        {
          id: lineId,
          kind: "LINE",
          description: "Ligne",
          quantityInput: "1",
          unitPriceCents: 100,
          vatRatePercent: 20,
        },
      ],
    });
    expect(() => applyQuotesMutation(createInitialQuotesPayload(), input, actor)).toThrow(
      "QUOTE_ITEM_PARENT_INVALID",
    );
  });

  it("can unlink a commercial case while the quote is still a draft", () => {
    const payload = createDraft();
    const input = quotesMutationSchema.parse({
      action: "update",
      quoteId,
      commercialCaseId: null,
    });
    const updated = applyQuotesMutation(payload, input, actor).payload.quotes[0];
    expect(updated.commercialCaseId).toBeNull();
  });

  it("assigns the immutable annual number only when sent", () => {
    const payload = createDraft();
    const input = quotesMutationSchema.parse({ action: "send", quoteId });
    const result = applyQuotesMutation(
      payload,
      input,
      actor,
      new Date("2026-09-13T13:00:00.000Z"),
      sendContext,
    ).payload;
    const quote = result.quotes[0];
    expect(quote.status).toBe("SENT");
    expect(quote.quoteNumber).toBe("D-2026-0001");
    expect(quote.numberSequence).toBe(1);
    expect(result.sequenceByYear["2026"]).toBe(1);
    expect(quote.clientSnapshot?.displayName).toBe("PAPOT TEST");
    expect(quote.clientSnapshot?.paymentTerms).toBe("45 jours fin de mois");
  });

  it("does not allocate another number when send is retried", () => {
    const payload = createDraft();
    const input = quotesMutationSchema.parse({ action: "send", quoteId });
    const sent = applyQuotesMutation(payload, input, actor, new Date(), sendContext).payload;
    const retry = applyQuotesMutation(sent, input, actor, new Date(), sendContext).payload;
    expect(retry.quotes[0].quoteNumber).toBe("D-2026-0001");
    expect(retry.sequenceByYear["2026"]).toBe(1);
  });

  it("allocates the next annual number to the next quote", () => {
    const firstDraft = createDraft();
    const sendFirst = quotesMutationSchema.parse({ action: "send", quoteId });
    const firstSent = applyQuotesMutation(firstDraft, sendFirst, actor, new Date(), sendContext).payload;
    const secondId = "77777777-7777-4777-8777-777777777777";
    const createSecond = quotesMutationSchema.parse({
      action: "create",
      quoteId: secondId,
      clientId,
      subject: "Deuxième devis",
      issueDate: "2026-10-01",
      paymentTerms: "Comptant",
      items: [
        {
          kind: "LINE",
          description: "Pose",
          quantityInput: "2",
          unitPriceCents: 5_000,
          vatRatePercent: 10,
        },
      ],
    });
    const secondDraft = applyQuotesMutation(firstSent, createSecond, actor).payload;
    const sendSecond = quotesMutationSchema.parse({ action: "send", quoteId: secondId });
    const secondSent = applyQuotesMutation(
      secondDraft,
      sendSecond,
      actor,
      new Date(),
      sendContext,
    ).payload;
    expect(secondSent.quotes.find((quote) => quote.id === secondId)?.quoteNumber).toBe(
      "D-2026-0002",
    );
  });

  it("rejects sending a quote without a billable line", () => {
    const create = quotesMutationSchema.parse({
      action: "create",
      quoteId,
      clientId,
      subject: "Vide",
      issueDate: "2026-09-13",
      paymentTerms: "Comptant",
      items: [{ kind: "COMMENT", text: "Information" }],
    });
    const payload = applyQuotesMutation(createInitialQuotesPayload(), create, actor).payload;
    const send = quotesMutationSchema.parse({ action: "send", quoteId });
    expect(() => applyQuotesMutation(payload, send, actor, new Date(), sendContext)).toThrow(
      "QUOTE_EMPTY",
    );
  });

  it("rejects editing after the quote has been sent", () => {
    const payload = createDraft();
    const send = quotesMutationSchema.parse({ action: "send", quoteId });
    const sent = applyQuotesMutation(payload, send, actor, new Date(), sendContext).payload;
    const update = quotesMutationSchema.parse({
      action: "update",
      quoteId,
      subject: "Modification interdite",
    });
    expect(() => applyQuotesMutation(sent, update, actor)).toThrow("QUOTE_NOT_DRAFT");
  });

  it("accepts only the frozen VAT rates", () => {
    expect(() =>
      quotesMutationSchema.parse({
        action: "create",
        clientId,
        subject: "TVA invalide",
        items: [
          {
            kind: "LINE",
            description: "Ligne",
            quantityInput: "1",
            unitPriceCents: 100,
            vatRatePercent: 7,
          },
        ],
      }),
    ).toThrow();
  });
});
