import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_FOLLOW_STATUS_OPTIONS,
  applyCommercialAutomaticTransitions,
  commercialHasSignedQuote,
  createInitialCommercialPayload,
  parseCommercialPayload,
} from "../src/lib/commercial/domain";
import {
  applyCommercialMutation,
  commercialMutationSchema,
  registerCommercialDocuments,
} from "../src/lib/commercial/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

function createPiste(reviewDate = "2026-09-20") {
  return applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: "Dupont - cuisine",
      clientName: "Dupont",
      siteLabel: "Roanne",
      description: "",
      nextAction: "",
      reviewDate,
    },
    actor,
    new Date("2026-09-13T08:00:00.000Z"),
  ).payload;
}

describe("Commercial V1", () => {
  it("exposes only the five global follow-up statuses in the workspace", () => {
    expect(COMMERCIAL_FOLLOW_STATUS_OPTIONS).toEqual([
      "PISTE",
      "SENT",
      "FOLLOW_UP",
      "WAITING",
      "CONFIRMED",
    ]);
  });

  it("creates a real piste with a mandatory review date", () => {
    expect(() =>
      commercialMutationSchema.parse({
        action: "create",
        name: "Sans date",
        clientName: "",
        siteLabel: "",
      }),
    ).toThrow();

    const payload = createPiste();
    expect(payload.cases[0].status).toBe("PISTE");
    expect(payload.cases[0].reviewDate).toBe("2026-09-20");
  });

  it("automatically moves a due piste to À relancer and keeps history", () => {
    const source = createPiste("2026-09-13");
    const result = applyCommercialAutomaticTransitions(
      source,
      new Date("2026-09-13T10:00:00.000Z"),
    );
    expect(result.changed).toBe(true);
    expect(result.payload.cases[0].status).toBe("FOLLOW_UP");
    expect(result.payload.cases[0].history.at(-1)?.type).toBe("AUTO_DUE");
  });

  it("requires owner and deadline for Chiffrage en cours", () => {
    const source = createPiste();
    const caseId = source.cases[0].id;
    expect(() =>
      applyCommercialMutation(source, { action: "setStatus", caseId, status: "CHIFFRAGE" }, actor),
    ).toThrow("COMMERCIAL_QUOTE_OWNER_AND_DATE_REQUIRED");

    const result = applyCommercialMutation(
      source,
      {
        action: "setStatus",
        caseId,
        status: "CHIFFRAGE",
        quoteOwnerName: "Lucien",
        quoteDueDate: "2026-09-18",
      },
      actor,
    ).payload.cases[0];
    expect(result.quoteOwnerName).toBe("Lucien");
    expect(result.quoteDueDate).toBe("2026-09-18");
  });

  it("marks a sent quote as Envoyé with a mandatory follow-up date", () => {
    const source = createPiste();
    const caseId = source.cases[0].id;
    expect(() => commercialMutationSchema.parse({ action: "markQuoteSent", caseId })).toThrow();

    const result = applyCommercialMutation(
      source,
      { action: "markQuoteSent", caseId, followUpDate: "2026-09-25" },
      actor,
      new Date("2026-09-13T11:00:00.000Z"),
    ).payload.cases[0];
    expect(result.status).toBe("SENT");
    expect(result.reviewDate).toBe("2026-09-25");
    expect(result.quoteSentAt).not.toBeNull();
  });

  it("automatically moves a due sent quote to À relancer", () => {
    const source = createPiste();
    const caseId = source.cases[0].id;
    const sent = applyCommercialMutation(
      source,
      { action: "markQuoteSent", caseId, followUpDate: "2026-09-14" },
      actor,
      new Date("2026-09-13T11:00:00.000Z"),
    ).payload;

    const result = applyCommercialAutomaticTransitions(sent, new Date("2026-09-14T10:00:00.000Z"));
    expect(result.changed).toBe(true);
    expect(result.payload.cases[0].status).toBe("FOLLOW_UP");
    expect(result.payload.cases[0].history.at(-1)?.type).toBe("AUTO_DUE");
  });

  it("requires a free follow-up summary", () => {
    const caseId = createPiste().cases[0].id;
    expect(() =>
      commercialMutationSchema.parse({
        action: "recordFollowUp",
        caseId,
        summary: "   ",
        nextStatus: "WAITING",
        nextDate: "2026-09-30",
      }),
    ).toThrow();
  });

  it("postpones a quote deadline only forward and histories the reason", () => {
    let source = createPiste();
    const caseId = source.cases[0].id;
    source = applyCommercialMutation(
      source,
      {
        action: "setStatus",
        caseId,
        status: "CHIFFRAGE",
        quoteOwnerName: "Nadia",
        quoteDueDate: "2026-09-18",
      },
      actor,
    ).payload;

    expect(() =>
      applyCommercialMutation(
        source,
        { action: "postponeQuoteDue", caseId, newDate: "2026-09-18", reason: "Attente plans" },
        actor,
      ),
    ).toThrow("COMMERCIAL_QUOTE_DATE_NOT_LATER");

    const result = applyCommercialMutation(
      source,
      { action: "postponeQuoteDue", caseId, newDate: "2026-09-22", reason: "Attente plans" },
      actor,
    ).payload.cases[0];
    expect(result.quoteDueDate).toBe("2026-09-22");
    expect(result.history.at(-1)?.summary).toContain("Attente plans");
    expect(result.history.at(-1)?.summary).toContain("2026-09-18");
  });

  it("requires a planned install date to confirm", () => {
    const source = createPiste();
    const caseId = source.cases[0].id;
    expect(() =>
      applyCommercialMutation(source, { action: "setStatus", caseId, status: "CONFIRMED" }, actor),
    ).toThrow("COMMERCIAL_INSTALL_DATE_REQUIRED");

    const confirmed = applyCommercialMutation(
      source,
      {
        action: "setStatus",
        caseId,
        status: "CONFIRMED",
        plannedInstallDate: "2026-11-10",
        retainedQuoteIds: [],
      },
      actor,
    ).payload.cases[0];
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.plannedInstallDate).toBe("2026-11-10");
    expect(confirmed.retainedQuoteIds).toEqual([]);
    expect(confirmed.history.some((event) => event.type === "QUOTES_RETAINED")).toBe(true);
  });

  it("keeps direct legacy confirmation compatible with an empty retained quote relation", () => {
    const source = createPiste();
    const caseId = source.cases[0].id;
    const confirmed = applyCommercialMutation(
      source,
      {
        action: "setStatus",
        caseId,
        status: "CONFIRMED",
        plannedInstallDate: "2026-11-10",
      },
      actor,
    ).payload.cases[0];

    expect(confirmed.retainedQuoteIds).toEqual([]);
  });

  it("loads older affairs without retained quote ids as an empty selection", () => {
    const source = createPiste();
    const legacy = structuredClone(source) as unknown as Record<string, unknown>;
    const cases = legacy.cases as Array<Record<string, unknown>>;
    delete cases[0].retainedQuoteIds;

    const parsed = parseCommercialPayload(legacy);
    expect(parsed.cases[0].retainedQuoteIds).toEqual([]);
  });

  it("tracks signed quote documents and current versions", () => {
    const source = createPiste();
    const caseId = source.cases[0].id;
    const first = registerCommercialDocuments(
      source,
      caseId,
      [
        {
          id: "22222222-2222-4222-8222-222222222222",
          fileName: "Devis V1.pdf",
          contentType: "application/pdf",
          sizeBytes: 100,
          sha256: "a".repeat(64),
          storagePath: "documents/commercial/2026/case/quote/doc/Devis V1.pdf",
          category: "QUOTE",
          versionLabel: "V1",
          variantLabel: null,
          isCurrent: true,
          isSignedQuote: false,
          uploadedAt: "2026-09-13T08:00:00.000Z",
          uploadedByName: "Lucien",
        },
      ],
      actor,
    ).payload;

    const second = registerCommercialDocuments(
      first,
      caseId,
      [
        {
          id: "33333333-3333-4333-8333-333333333333",
          fileName: "Devis V2 signe.pdf",
          contentType: "application/pdf",
          sizeBytes: 120,
          sha256: "b".repeat(64),
          storagePath: "documents/commercial/2026/case/quote/doc2/Devis V2 signe.pdf",
          category: "QUOTE",
          versionLabel: "V2",
          variantLabel: null,
          isCurrent: true,
          isSignedQuote: true,
          uploadedAt: "2026-09-13T09:00:00.000Z",
          uploadedByName: "Lucien",
        },
      ],
      actor,
    ).payload.cases[0];

    expect(second.documents[0].isCurrent).toBe(false);
    expect(second.documents[1].isCurrent).toBe(true);
    expect(commercialHasSignedQuote(second)).toBe(true);
  });

  it("closes without deleting history/documents and reopening does not restore provision", () => {
    let source = createPiste();
    const caseId = source.cases[0].id;
    source = applyCommercialMutation(
      source,
      { action: "updateProvision", caseId, be: 5, workshop: 20, install: 8 },
      actor,
    ).payload;
    const historyBeforeClose = source.cases[0].history.length;

    const closed = applyCommercialMutation(
      source,
      { action: "close", caseId, status: "LOST", reason: "Budget client" },
      actor,
    ).payload;
    expect(closed.cases[0].status).toBe("LOST");
    expect(closed.cases[0].provisionHours).toEqual({ be: 0, workshop: 0, install: 0 });
    expect(closed.cases[0].history.length).toBeGreaterThan(historyBeforeClose);

    const reopened = applyCommercialMutation(
      closed,
      { action: "reopen", caseId, reviewDate: "2026-10-01" },
      actor,
    ).payload.cases[0];
    expect(reopened.status).toBe("PISTE");
    expect(reopened.provisionHours).toEqual({ be: 0, workshop: 0, install: 0 });
    expect(reopened.reviewDate).toBe("2026-10-01");
  });
});
