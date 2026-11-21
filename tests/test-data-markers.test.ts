import { describe, expect, it } from "vitest";
import {
  createInitialCommercialPayload,
  parseCommercialPayload,
} from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import {
  createInitialNativeQuotesPayload,
  parseNativeQuotesPayload,
} from "../src/lib/quotes/store";
import { applyQuotesMutation } from "../src/lib/quotes/mutations";
import {
  createInitialChantiersPayload,
  parseChantiersPayload,
} from "../src/lib/chantiers/domain";
import { applyChantierMutation, launchChantierFromCommercial } from "../src/lib/chantiers/mutations";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const clientId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-21T10:00:00.000Z");

function createAffair(isTest: boolean) {
  return applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: isTest ? "Essai agencement" : "Vrai chantier",
      clientName: "Client de recette",
      siteLabel: "Roanne",
      description: "",
      nextAction: "",
      reviewDate: "2026-12-01",
      isTest,
    },
    actor,
    now,
  ).payload;
}

describe("Marqueur de recette: affaires, devis et chantiers", () => {
  it("marque une affaire de test à la création et historise chaque changement", () => {
    const created = createAffair(true);
    const item = created.cases[0];
    expect(item.isTest).toBe(true);
    const unmarked = applyCommercialMutation(
      created, { action: "setTestMarker", caseId: item.id, isTest: false }, actor, now,
    ).payload;
    expect(unmarked.cases[0].isTest).toBe(false);
    expect(unmarked.cases[0].history.at(-1)?.type).toBe("TEST_MARKER_UPDATED");
    expect(created.cases[0].isTest).toBe(true);
    expect(parseCommercialPayload(unmarked).cases[0].isTest).toBe(false);
  });

  it("transmet le marqueur d'une affaire aux nouveaux devis, sans marquer les vrais dossiers", () => {
    const testAffair = createAffair(true).cases[0];
    const input = {
      action: "createDraft" as const,
      commercialCaseId: testAffair.id,
      subject: "Devis recette",
      issueDate: "2026-11-21",
      paymentTerms: "30 jours",
      variantName: "Base",
      quoteKind: "STANDARD" as const,
    };
    const testQuote = applyQuotesMutation(
      createInitialNativeQuotesPayload(), input, actor, clientId, now,
      undefined, undefined, testAffair.isTest === true,
    ).payload;
    expect(testQuote.quotes[0].isTest).toBe(true);
    expect(parseNativeQuotesPayload(testQuote).quotes[0].isTest).toBe(true);

    const realQuote = applyQuotesMutation(
      createInitialNativeQuotesPayload(), input, actor, clientId, now,
    ).payload;
    expect(realQuote.quotes[0].isTest).toBe(false);
    expect(realQuote.quotes[0].model.subject).toBe("Devis recette");
  });

  it("permet de marquer un ancien devis sans toucher à sa structure ni ses prix", () => {
    const payload = applyQuotesMutation(
      createInitialNativeQuotesPayload(), {
        action: "createDraft",
        commercialCaseId: createAffair(false).cases[0].id,
        subject: "Essai ancien",
        issueDate: "2026-11-21",
        paymentTerms: "30 jours",
        variantName: "Base",
      }, actor, clientId, now,
    ).payload;
    const original = payload.quotes[0];
    const marked = applyQuotesMutation(
      payload, { action: "setTestMarker", quoteId: original.id, isTest: true },
      actor, undefined, new Date("2026-11-21T11:00:00.000Z"),
    ).payload;
    expect(marked.quotes[0].isTest).toBe(true);
    expect(marked.quotes[0].model).toEqual(original.model);
    expect(marked.quotes[0].updatedByName).toBe("Lucien");
    expect(payload.quotes[0].isTest).toBe(false);
    const unmarked = applyQuotesMutation(
      marked, { action: "setTestMarker", quoteId: original.id, isTest: false },
      actor,
    ).payload;
    expect(unmarked.quotes[0].isTest).toBe(false);
  });

  it("transmet le marqueur de l'affaire au chantier lors de son lancement", () => {
    const created = createAffair(true);
    const confirmed = applyCommercialMutation(
      created,
      {
        action: "setStatus",
        caseId: created.cases[0].id,
        status: "CONFIRMED",
        plannedInstallDate: "2026-12-12",
      },
      actor,
      now,
    ).payload;
    const linked = launchChantierFromCommercial(
      createInitialChantiersPayload(),
      confirmed.cases[0],
      {
        commercialCaseId: confirmed.cases[0].id,
        quoteMissingDeclared: true,
        signedQuoteMissingDeclared: true,
        costingMissingDeclared: true,
        be: 0,
        workshop: 0,
        install: 0,
      },
      actor,
      now,
    ).payload;
    expect(linked.chantiers[0].isTest).toBe(true);
    const before = linked.chantiers[0];
    const after = applyChantierMutation(
      linked,
      { action: "setTestMarker", chantierId: before.id, isTest: false },
      actor, new Date("2026-11-21T11:00:00.000Z"),
    ).payload;
    expect(after.chantiers[0].isTest).toBe(false);
    expect(after.chantiers[0].history.at(-1)?.type).toBe("TEST_MARKER_UPDATED");
    expect(after.chantiers[0].plannedHours).toEqual(before.plannedHours);
    expect(parseChantiersPayload(after).chantiers[0].isTest).toBe(false);
  });

  it("reste compatible avec les données historiques non marquées", () => {
    const source = createAffair(false);
    const legacy = structuredClone(source) as unknown as {
      cases: Array<Record<string, unknown>>;
    };
    delete legacy.cases[0].isTest;
    expect(parseCommercialPayload(legacy).cases[0].isTest).toBeUndefined();
    // Une donnée sans marqueur n'est jamais considérée comme un essai.
    expect(parseCommercialPayload(legacy).cases[0].isTest === true).toBe(false);
  });
});
