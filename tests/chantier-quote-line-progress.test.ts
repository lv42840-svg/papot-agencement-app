import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createInitialChantiersPayload, parseChantiersPayload } from "../src/lib/chantiers/domain";
import {
  applyChantierMutation,
  launchChantierFromCommercial,
} from "../src/lib/chantiers/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

function launch() {
  let commercial = applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: "Boutique test",
      clientName: "Client",
      siteLabel: "Roanne",
      description: "",
      nextAction: "",
      reviewDate: "2026-09-30",
    },
    actor,
    new Date("2026-09-14T08:00:00.000Z"),
  ).payload;

  const caseId = commercial.cases[0].id;
  commercial = applyCommercialMutation(
    commercial,
    {
      action: "setStatus",
      caseId,
      status: "CONFIRMED",
      plannedInstallDate: "2026-11-10",
    },
    actor,
    new Date("2026-09-14T09:00:00.000Z"),
  ).payload;

  const affair = commercial.cases[0];
  return launchChantierFromCommercial(
    createInitialChantiersPayload(),
    affair,
    {
      commercialCaseId: affair.id,
      quoteMissingDeclared: true,
      signedQuoteMissingDeclared: true,
      costingMissingDeclared: true,
      be: 2,
      workshop: 12,
      install: 6,
    },
    actor,
    new Date("2026-09-14T10:00:00.000Z"),
  ).payload;
}

describe("chantier retained quote line progress", () => {
  it("stores only the durable quote-line identity and chantier progress", () => {
    const source = launch();
    const chantierId = source.chantiers[0].id;
    const quoteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const quoteLineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const done = applyChantierMutation(
      source,
      {
        action: "setQuoteLineProgress",
        chantierId,
        quoteId,
        quoteLineId,
        status: "DONE",
        quoteLineLabel: "D-2026-0001 · Banque accueil",
      },
      actor,
      new Date("2026-09-14T12:00:00.000Z"),
    ).payload.chantiers[0];

    expect(done.operational.quoteLineProgress).toEqual([
      {
        quoteId,
        quoteLineId,
        status: "DONE",
        updatedAt: "2026-09-14T12:00:00.000Z",
        updatedByName: "Lucien",
      },
    ]);
    expect(done.history.at(-1)?.summary).toContain("À faire → Réalisée");

    const reopened = applyChantierMutation(
      { schemaVersion: 1, chantiers: [done] },
      {
        action: "setQuoteLineProgress",
        chantierId,
        quoteId,
        quoteLineId,
        status: "TODO",
        quoteLineLabel: "D-2026-0001 · Banque accueil",
      },
      actor,
      new Date("2026-09-14T13:00:00.000Z"),
    ).payload.chantiers[0];

    expect(reopened.operational.quoteLineProgress[0].status).toBe("TODO");
    expect(reopened.history.at(-1)?.summary).toContain("Réalisée → À faire");
  });

  it("defaults legacy chantier data to an empty quote-line checklist", () => {
    const source = launch();
    const legacy = JSON.parse(JSON.stringify(source)) as {
      chantiers: Array<{ operational: { quoteLineProgress?: unknown } }>;
    };
    delete legacy.chantiers[0].operational.quoteLineProgress;

    expect(parseChantiersPayload(legacy).chantiers[0].operational.quoteLineProgress).toEqual([]);
  });
});
