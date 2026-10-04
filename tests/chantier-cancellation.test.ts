import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chantierSpecialPermissionForMutation } from "../src/lib/auth/action-permissions";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import {
  createInitialChantiersPayload,
  parseChantiersPayload,
  CHANTIER_STATUS_LABELS,
} from "../src/lib/chantiers/domain";
import { launchChantierFromAffair } from "../src/lib/chantiers/launch-from-affair";
import {
  applyChantierMutation,
  assertChantierRevision,
  chantierMutationSchema,
} from "../src/lib/chantiers/mutations";
import {
  createInitialPlanningPayload,
  buildFirmGrandPlanningRows,
} from "../src/lib/planning/domain";
import {
  removeFirmPlanningForChantier,
  restoreFirmPlanningOrderForChantier,
} from "../src/lib/planning/mutations";

const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Lucien" };
const closedAt = new Date("2026-10-04T20:00:00.000Z");

function fixture() {
  const commercial = applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: "Chantier de test",
      clientName: "Client test",
      siteLabel: "Roanne",
      description: "Cuisine",
      nextAction: "Préparer",
      reviewDate: "2026-10-04",
    },
    actor,
  ).payload;
  const affair = commercial.cases[0];
  affair.status = "CONFIRMED";
  affair.plannedInstallDate = "2026-12-10";
  affair.retainedQuoteIds = ["88888888-8888-4888-8888-888888888888"];
  const payload = launchChantierFromAffair(
    createInitialChantiersPayload(),
    affair,
    { commercialCaseId: affair.id, be: 8, workshop: 32, install: 16 },
    actor,
    new Date("2026-10-01T08:00:00.000Z"),
  ).payload;
  payload.chantiers[0].actualHours = { be: 3, workshop: 4, install: 0 };
  const item = payload.chantiers[0];
  const input = chantierMutationSchema.parse({
    action: "cancel",
    chantierId: item.id,
    reason: "Abandon du client",
    confirmed: true,
  });
  return { payload, item, input, commercial };
}

describe("chantier cancellation", () => {
  it("cancels without pretending work is complete or deleting dossier data", () => {
    const { payload, item, input, commercial } = fixture();
    const before = structuredClone(payload);
    const commercialBefore = structuredClone(commercial);
    const result = applyChantierMutation(payload, input, actor, closedAt);
    const cancelled = result.payload.chantiers[0];
    expect(cancelled.status).toBe("CANCELLED");
    expect(CHANTIER_STATUS_LABELS[cancelled.status]).toBe("Annulé");
    expect(cancelled.completedAt).toBeNull();
    expect(cancelled.id).toBe(item.id);
    expect(cancelled.number).toBe(item.number);
    expect(cancelled.sourceCommercialCaseId).toBe(item.sourceCommercialCaseId);
    expect(cancelled.initialRetainedQuoteIds).toEqual(item.initialRetainedQuoteIds);
    expect(cancelled.plannedHours).toEqual(item.plannedHours);
    expect(cancelled.actualHours).toEqual(item.actualHours);
    expect(cancelled.operational).toEqual(item.operational);
    expect(cancelled.launchDocuments).toEqual(item.launchDocuments);
    expect(cancelled.history.slice(0, -1)).toEqual(item.history);
    expect(cancelled.history.at(-1)).toMatchObject({
      type: "CANCELLED",
      actorName: actor.displayName,
      at: closedAt.toISOString(),
      summary: "Chantier annulé. Motif : Abandon du client",
    });
    expect(parseChantiersPayload(result.payload).chantiers[0].status).toBe("CANCELLED");
    expect(payload).toEqual(before);
    expect(commercial).toEqual(commercialBefore);
  });

  it("requires a meaningful bounded reason and explicit confirmation", () => {
    const { item } = fixture();
    for (const reason of ["", "  ", "x".repeat(1001)]) {
      expect(
        chantierMutationSchema.safeParse({
          action: "cancel",
          chantierId: item.id,
          reason,
          confirmed: true,
        }).success,
      ).toBe(false);
    }
    for (const confirmed of [undefined, false, "true"]) {
      expect(
        chantierMutationSchema.safeParse({
          action: "cancel",
          chantierId: item.id,
          reason: "Test",
          confirmed,
        }).success,
      ).toBe(false);
    }
    expect(
      chantierMutationSchema.safeParse({
        action: "cancel",
        chantierId: item.id,
        reason: "x".repeat(1000),
        confirmed: true,
      }).success,
    ).toBe(true);
  });

  it("uses the close/reopen permission instead of a new permission bypass", () => {
    for (const action of ["cancel", "markDone", "reactivate"]) {
      expect(chantierSpecialPermissionForMutation({ action })).toBe("chantiers.close_reopen");
    }
    expect(chantierSpecialPermissionForMutation({ action: "archive" })).toBe(
      "chantiers.archive_reactivate",
    );
  });

  it("only cancels active dossiers and prevents repeat cancellations", () => {
    const { payload, input } = fixture();
    for (const status of ["DONE", "ARCHIVED"] as const) {
      const copy = structuredClone(payload);
      copy.chantiers[0].status = status;
      expect(() => applyChantierMutation(copy, input, actor, closedAt)).toThrow(
        "CHANTIER_NOT_ACTIVE",
      );
    }
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    expect(() => applyChantierMutation(cancelled, input, actor, closedAt)).toThrow(
      "CHANTIER_CANCELLED_READ_ONLY",
    );
  });

  it("keeps cancelled operational data read-only until reopening", () => {
    const { payload, input, item } = fixture();
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    for (const mutation of [
      {
        action: "updatePlannedHours",
        chantierId: item.id,
        be: 1,
        workshop: 1,
        install: 1,
        reason: "Test",
      },
      {
        action: "setOperationalSpaceState",
        chantierId: item.id,
        spaceId: "be",
        state: "NOT_APPLICABLE",
      },
      { action: "updateDetails", chantierId: item.id, name: "Changed" },
    ]) {
      expect(() =>
        applyChantierMutation(cancelled, chantierMutationSchema.parse(mutation), actor),
      ).toThrow("CHANTIER_CANCELLED_READ_ONLY");
    }
  });

  it("can reopen or archive a cancelled dossier without changing its identity", () => {
    const { payload, input, item } = fixture();
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    const reopened = applyChantierMutation(
      cancelled,
      { action: "reactivate", chantierId: item.id, reason: "Client revient" },
      actor,
    ).payload;
    expect(reopened.chantiers[0]).toMatchObject({
      id: item.id,
      number: item.number,
      status: "ACTIVE",
      actualHours: item.actualHours,
    });
    expect(reopened.chantiers[0].history.some((event) => event.type === "CANCELLED")).toBe(true);
    const archived = applyChantierMutation(
      cancelled,
      { action: "archive", chantierId: item.id, openItemsReviewed: true },
      actor,
    ).payload;
    expect(archived.chantiers[0].status).toBe("ARCHIVED");
    expect(archived.chantiers[0].history.some((event) => event.type === "CANCELLED")).toBe(true);
  });

  it("removes planned capacity but keeps actual hours and other chantiers intact", () => {
    const { payload, input, item } = fixture();
    const otherId = "99999999-9999-4999-8999-999999999999";
    const planning = createInitialPlanningPayload();
    planning.chantierOrder = [item.id, otherId];
    planning.macroAllocations = [
      { chantierId: item.id, activity: "WORKSHOP", week: "2026-W50", hours: 32 },
      { chantierId: otherId, activity: "INSTALL", week: "2026-W50", hours: 8 },
    ];
    planning.actualHours = [
      { chantierId: item.id, userId: actor.userId, activity: "BE", week: "2026-W40", hours: 3 },
    ];
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    const cleared = removeFirmPlanningForChantier(planning, item.id);
    expect(cleared.macroAllocations).toEqual([planning.macroAllocations[1]]);
    expect(cleared.chantierOrder).toEqual([otherId]);
    expect(cleared.actualHours).toEqual(planning.actualHours);
    expect(buildFirmGrandPlanningRows(cancelled, cleared, 2026)).toEqual([]);
    const reopened = applyChantierMutation(
      cancelled,
      { action: "reactivate", chantierId: item.id, reason: "Reprise" },
      actor,
    ).payload;
    const restored = restoreFirmPlanningOrderForChantier(cleared, item.id);
    expect(restored.chantierOrder).toEqual([item.id, otherId]);
    expect(restored.macroAllocations).toEqual(cleared.macroAllocations);
    expect(restored.actualHours).toEqual(planning.actualHours);
    expect(buildFirmGrandPlanningRows(reopened, restored, 2026)).toHaveLength(1);
  });

  it("does not accept an obsolete dossier revision", () => {
    const { item } = fixture();
    expect(() => assertChantierRevision(item, "2026-01-01T00:00:00.000Z")).toThrow(
      "CHANTIERS_VERSION_CONFLICT",
    );
    expect(() => assertChantierRevision(item, item.updatedAt)).not.toThrow();
  });

  it("wires the cancellation and required revision into the UI and API", () => {
    const ui = readFileSync(
      new URL("../src/components/chantier-workspace.tsx", import.meta.url),
      "utf8",
    );
    const api = readFileSync(
      new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url),
      "utf8",
    );
    const list = readFileSync(
      new URL("../src/components/chantiers-workspace.tsx", import.meta.url),
      "utf8",
    );
    expect(ui).toContain("expectedUpdatedAt: body.expectedUpdatedAt ?? current.updatedAt");
    expect(ui).toContain("Confirmer l’annulation");
    expect(ui).toContain("Clôturer le chantier");
    expect(ui).toContain("!cancelConfirmed");
    expect(ui).toContain("confirmed: true");
    expect(api).toContain('input.action === "markDone" || input.action === "cancel"');
    expect(api).toContain("assertChantierRevision(openedChantier, expectedUpdatedAt)");
    expect(list).toContain('setMode("CANCELLED")');
  });
});
