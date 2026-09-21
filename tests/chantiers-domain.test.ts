import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createInitialChantiersPayload, parseChantiersPayload } from "../src/lib/chantiers/domain";
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
    const commercialCase = confirmedCommercialCase();
    const result = launchChantierFromCommercial(
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
    const item = result.payload.chantiers[0];
    expect(item.status).toBe("ACTIVE");
    expect(item.plannedHours).toEqual({ be: 0, workshop: 32, install: 16 });
    expect(item.sourceCommercialCaseId).toBe(commercialCase.id);
    expect(item.id).toBe(commercialCase.id);
    expect(item.operational).toEqual({
      spaces: {
        admin: "APPLICABLE",
        be: "APPLICABLE",
        workshop: "APPLICABLE",
        install: "APPLICABLE",
        meeting: "APPLICABLE",
        mail: "APPLICABLE",
        reception: "APPLICABLE",
      },
      beItems: [],
      workshopItems: [],
      installItems: [],
      quoteLineProgress: [],
    });
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

  it("creates Atelier and Pose when a BE item is validated for an in-house installation", () => {
    let source = launch().payload;
    const chantierId = source.chantiers[0].id;
    source = applyChantierMutation(
      source,
      {
        action: "createBeItem",
        chantierId,
        name: "Banque accueil",
        originKind: "QUOTE_LINE",
        originLabel: "1.2 Banque accueil",
        installedByUs: true,
      },
      actor,
      new Date("2026-09-14T09:00:00.000Z"),
    ).payload;

    const beItem = source.chantiers[0].operational.beItems[0];
    const validated = applyChantierMutation(
      source,
      { action: "setBeStatus", chantierId, beItemId: beItem.id, status: "VALIDATED" },
      actor,
      new Date("2026-09-14T10:00:00.000Z"),
    ).payload.chantiers[0];

    expect(validated.operational.workshopItems).toHaveLength(1);
    expect(validated.operational.workshopItems[0].sourceBeItemId).toBe(beItem.id);
    expect(validated.operational.installItems).toHaveLength(1);
    expect(validated.operational.installItems[0].sourceBeItemId).toBe(beItem.id);
    expect(validated.operational.installItems[0].status).toBe("TODO");
  });

  it("creates a direct Atelier item and its Pose tracking without forcing a BE item", () => {
    const source = launch().payload;
    const chantierId = source.chantiers[0].id;
    const result = applyChantierMutation(
      source,
      {
        action: "createWorkshopItem",
        chantierId,
        name: "Tablette complémentaire",
        originKind: "TS",
        originLabel: "Ajout demandé en réunion",
        installedByUs: true,
      },
      actor,
      new Date("2026-09-14T11:00:00.000Z"),
    ).payload.chantiers[0];

    expect(result.operational.beItems).toHaveLength(0);
    expect(result.operational.workshopItems).toHaveLength(1);
    expect(result.operational.workshopItems[0].sourceBeItemId).toBeNull();
    expect(result.operational.installItems).toHaveLength(1);
    expect(result.operational.installItems[0].sourceWorkshopItemId).toBe(
      result.operational.workshopItems[0].id,
    );
  });

  it("keeps Atelier and Pose progress independent", () => {
    let source = launch().payload;
    const chantierId = source.chantiers[0].id;
    source = applyChantierMutation(
      source,
      {
        action: "createWorkshopItem",
        chantierId,
        name: "Habillage mural",
        originKind: "QUOTE_LINE",
        originLabel: "2.4 Habillage mural",
        installedByUs: true,
      },
      actor,
    ).payload;

    const workshop = source.chantiers[0].operational.workshopItems[0];
    const installation = source.chantiers[0].operational.installItems[0];
    const afterWorkshop = applyChantierMutation(
      source,
      { action: "setWorkshopStatus", chantierId, workshopItemId: workshop.id, status: "DONE" },
      actor,
    ).payload;

    expect(afterWorkshop.chantiers[0].operational.installItems[0].status).toBe("TODO");

    const afterInstall = applyChantierMutation(
      afterWorkshop,
      {
        action: "setInstallStatus",
        chantierId,
        installItemId: installation.id,
        status: "IN_PROGRESS",
        note: "Première zone posée",
      },
      actor,
    ).payload.chantiers[0];
    expect(afterInstall.operational.workshopItems[0].status).toBe("DONE");
    expect(afterInstall.operational.installItems[0].status).toBe("IN_PROGRESS");
    expect(afterInstall.operational.installItems[0].note).toBe("Première zone posée");
  });

  it("defaults legacy operational spaces to Applicable", () => {
    const source = launch().payload;
    const legacy = JSON.parse(JSON.stringify(source)) as {
      chantiers: Array<{ operational: { spaces?: unknown } }>;
    };
    delete legacy.chantiers[0].operational.spaces;

    const parsed = parseChantiersPayload(legacy);
    expect(parsed.chantiers[0].operational.spaces).toEqual({
      admin: "APPLICABLE",
      be: "APPLICABLE",
      workshop: "APPLICABLE",
      install: "APPLICABLE",
      meeting: "APPLICABLE",
      mail: "APPLICABLE",
      reception: "APPLICABLE",
    });
  });

  it("marks an operational space Non concerné without deleting its data", () => {
    let source = launch().payload;
    const chantierId = source.chantiers[0].id;
    source = applyChantierMutation(
      source,
      {
        action: "createBeItem",
        chantierId,
        name: "Banque accueil",
        originKind: "QUOTE_LINE",
        originLabel: "1.2 Banque accueil",
        installedByUs: true,
      },
      actor,
    ).payload;

    const excluded = applyChantierMutation(
      source,
      { action: "setOperationalSpaceState", chantierId, spaceId: "be", state: "NOT_APPLICABLE" },
      actor,
    ).payload.chantiers[0];
    expect(excluded.operational.spaces.be).toBe("NOT_APPLICABLE");
    expect(excluded.operational.beItems).toHaveLength(1);
    expect(excluded.history.at(-1)?.type).toBe("OPERATIONAL_SPACE_STATE_UPDATED");

    const restored = applyChantierMutation(
      { schemaVersion: 1, chantiers: [excluded] },
      { action: "setOperationalSpaceState", chantierId, spaceId: "be", state: "APPLICABLE" },
      actor,
    ).payload.chantiers[0];
    expect(restored.operational.spaces.be).toBe("APPLICABLE");
    expect(restored.operational.beItems).toHaveLength(1);
  });

  it("snapshots the retained quotes present when the chantier is launched", () => {
    const commercialCase = confirmedCommercialCase();
    const retainedQuoteId = "88888888-8888-4888-8888-888888888888";
    commercialCase.retainedQuoteIds = [retainedQuoteId];

    const result = launchChantierFromCommercial(
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
    ).payload.chantiers[0];

    expect(result.initialRetainedQuoteIds).toEqual([retainedQuoteId]);
    expect(result.launchDocuments.quote).toBe("PRESENT");
  });

  it("propagates durable quote ids from BE to Atelier and Pose", () => {
    let source = launch().payload;
    const chantierId = source.chantiers[0].id;
    const quoteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const quoteLineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    source = applyChantierMutation(
      source,
      {
        action: "createBeItem",
        chantierId,
        name: "Banque accueil",
        originKind: "QUOTE_LINE",
        originLabel: "D-2026-0001 · Banque accueil",
        sourceQuoteId: quoteId,
        sourceQuoteLineId: quoteLineId,
        installedByUs: true,
      },
      actor,
    ).payload;

    const be = source.chantiers[0].operational.beItems[0];
    const validated = applyChantierMutation(
      source,
      { action: "setBeStatus", chantierId, beItemId: be.id, status: "VALIDATED" },
      actor,
    ).payload.chantiers[0];

    expect(be.sourceQuoteId).toBe(quoteId);
    expect(be.sourceQuoteLineId).toBe(quoteLineId);
    expect(validated.operational.workshopItems[0].sourceQuoteId).toBe(quoteId);
    expect(validated.operational.workshopItems[0].sourceQuoteLineId).toBe(quoteLineId);
    expect(validated.operational.installItems[0].sourceQuoteId).toBe(quoteId);
    expect(validated.operational.installItems[0].sourceQuoteLineId).toBe(quoteLineId);
  });

  it("defaults legacy chantier quote links without destructive migration", () => {
    const source = launch().payload;
    const legacy = JSON.parse(JSON.stringify(source)) as {
      chantiers: Array<{
        initialRetainedQuoteIds?: unknown;
        operational: { beItems: Array<Record<string, unknown>> };
      }>;
    };
    delete legacy.chantiers[0].initialRetainedQuoteIds;

    const parsed = parseChantiersPayload(legacy);
    expect(parsed.chantiers[0].initialRetainedQuoteIds).toEqual([]);
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
      applyChantierMutation(
        source,
        { action: "archive", chantierId: id, openItemsReviewed: true },
        actor,
      ),
    ).toThrow("CHANTIER_NOT_DONE");

    const done = applyChantierMutation(
      source,
      { action: "markDone", chantierId: id },
      actor,
    ).payload;
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
