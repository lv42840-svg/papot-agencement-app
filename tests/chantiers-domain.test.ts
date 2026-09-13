import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createInitialChantiersPayload } from "../src/lib/chantiers/domain";
import {
  applyChantierMutation,
  chantierMutationSchema,
  launchChantierFromCommercial,
} from "../src/lib/chantiers/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};

function confirmedCommercialCase() {
  let commercial = applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: "Dupont - cuisine",
      clientName: "Dupont",
      siteLabel: "Roanne",
      description: "",
      nextAction: "",
      reviewDate: "2026-09-20",
    },
    actor,
    new Date("2026-09-13T08:00:00.000Z"),
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
    new Date("2026-09-13T09:00:00.000Z"),
  ).payload;

  return commercial.cases[0];
}

function launch() {
  const commercialCase = confirmedCommercialCase();
  return launchChantierFromCommercial(
    createInitialChantiersPayload(),
    commercialCase,
    {
      commercialCaseId: commercialCase.id,
      quoteMissingDeclared: true,
      signedQuoteMissingDeclared: true,
      costingMissingDeclared: true,
      be: 0,
      workshop: 32,
      install: 16,
    },
    actor,
    new Date("2026-09-13T10:00:00.000Z"),
  );
}

describe("Chantiers V1 foundation", () => {
  it("launches only from a confirmed commercial case", () => {
    const piste = applyCommercialMutation(
      createInitialCommercialPayload(),
      {
        action: "create",
        name: "Piste",
        clientName: "",
        siteLabel: "",
        description: "",
        nextAction: "",
        reviewDate: "2026-09-20",
      },
      actor,
    ).payload.cases[0];

    expect(() =>
      launchChantierFromCommercial(
        createInitialChantiersPayload(),
        piste,
        {
          commercialCaseId: piste.id,
          quoteMissingDeclared: true,
          signedQuoteMissingDeclared: true,
          costingMissingDeclared: true,
          be: 0,
          workshop: 0,
          install: 0,
        },
        actor,
      ),
    ).toThrow("CHANTIER_COMMERCIAL_NOT_CONFIRMED");
  });

  it("requires an explicit declaration for every missing launch document", () => {
    const commercialCase = confirmedCommercialCase();
    expect(() =>
      launchChantierFromCommercial(
        createInitialChantiersPayload(),
        commercialCase,
        {
          commercialCaseId: commercialCase.id,
          quoteMissingDeclared: false,
          signedQuoteMissingDeclared: true,
          costingMissingDeclared: true,
          be: 0,
          workshop: 0,
          install: 0,
        },
        actor,
      ),
    ).toThrow("CHANTIER_QUOTE_DECLARATION_REQUIRED");
  });

  it("accepts zero-hour activities and preserves the commercial source link", () => {
    const result = launch();
    const item = result.payload.chantiers[0];
    expect(item.status).toBe("ACTIVE");
    expect(item.plannedHours).toEqual({ be: 0, workshop: 32, install: 16 });
    expect(item.sourceCommercialCaseId).toBe(item.id);
    expect(item.launchDocuments).toEqual({
      quote: "MISSING_DECLARED",
      signedQuote: "MISSING_DECLARED",
      costing: "MISSING_DECLARED",
    });
  });

  it("blocks launching the same commercial affair twice", () => {
    const first = launch();
    const commercialCase = confirmedCommercialCase();
    const sourceCase = {
      ...commercialCase,
      id: first.payload.chantiers[0].sourceCommercialCaseId,
    };
    expect(() =>
      launchChantierFromCommercial(
        first.payload,
        sourceCase,
        {
          commercialCaseId: sourceCase.id,
          quoteMissingDeclared: true,
          signedQuoteMissingDeclared: true,
          costingMissingDeclared: true,
          be: 0,
          workshop: 0,
          install: 0,
        },
        actor,
      ),
    ).toThrow("CHANTIER_ALREADY_LAUNCHED");
  });

  it("requires a free reason when planned hours are changed", () => {
    const item = launch().payload.chantiers[0];
    expect(() =>
      chantierMutationSchema.parse({
        action: "updatePlannedHours",
        chantierId: item.id,
        be: 2,
        workshop: 35,
        install: 16,
        reason: "   ",
      }),
    ).toThrow();
  });

  it("histories before and after values when predicted hours change", () => {
    const source = launch().payload;
    const item = source.chantiers[0];
    const result = applyChantierMutation(
      source,
      {
        action: "updatePlannedHours",
        chantierId: item.id,
        be: 4,
        workshop: 40,
        install: 18,
        reason: "Complément demandé",
      },
      actor,
      new Date("2026-09-14T08:00:00.000Z"),
    ).payload.chantiers[0];

    expect(result.plannedHours).toEqual({ be: 4, workshop: 40, install: 18 });
    expect(result.history.at(-1)?.summary).toContain("Atelier 32 → 40 h");
    expect(result.history.at(-1)?.summary).toContain("Complément demandé");
  });

  it("supports Active → Terminé → Active without recreating the chantier", () => {
    const source = launch().payload;
    const id = source.chantiers[0].id;
    const done = applyChantierMutation(
      source,
      { action: "markDone", chantierId: id },
      actor,
    ).payload;
    expect(done.chantiers[0].status).toBe("DONE");

    const active = applyChantierMutation(
      done,
      { action: "reactivate", chantierId: id, reason: "Reprise de travaux" },
      actor,
    ).payload.chantiers[0];
    expect(active.status).toBe("ACTIVE");
    expect(active.id).toBe(id);
  });

  it("archives only from Terminé and requires a reason for full reactivation", () => {
    const source = launch().payload;
    const id = source.chantiers[0].id;
    expect(() =>
      applyChantierMutation(source, { action: "archive", chantierId: id, openItemsReviewed: true }, actor),
    ).toThrow("CHANTIER_NOT_DONE");

    const done = applyChantierMutation(source, { action: "markDone", chantierId: id }, actor).payload;
    const archived = applyChantierMutation(
      done,
      { action: "archive", chantierId: id, openItemsReviewed: true },
      actor,
    ).payload;
    expect(archived.chantiers[0].status).toBe("ARCHIVED");

    expect(() =>
      chantierMutationSchema.parse({ action: "unarchive", chantierId: id, reason: "   " }),
    ).toThrow();

    const active = applyChantierMutation(
      archived,
      { action: "unarchive", chantierId: id, reason: "Nouveau besoin chantier" },
      actor,
    ).payload.chantiers[0];
    expect(active.status).toBe("ACTIVE");
    expect(active.history.at(-1)?.summary).toContain("Nouveau besoin chantier");
  });
});
