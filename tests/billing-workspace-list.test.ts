import { describe, expect, it } from "vitest";
import {
  createBillingDraft,
  type BillingDraft,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  filterBillingProjects,
  type BillingProjectFilter,
} from "../src/lib/billing/workspace-list";

const source: BillingSource = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Études Bâtiment",
  affairName: "Chantier Lyon",
  quoteLabel: "D-2026-101",
  contractHtCents: 180_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 180_000 }],
};
const otherSite = "55555555-5555-4555-8555-555555555555";

function draft(overrides: Partial<BillingDraft> = {}): BillingDraft {
  return {
    ...createBillingDraft(
      { schemaVersion: 1, drafts: [] },
      source,
      { requestId: crypto.randomUUID(), type: "DEPOSIT", cumulativePercent: 30 },
      "Lucien",
    ),
    ...overrides,
  };
}

const baseFilter: BillingProjectFilter = {
  search: "",
  type: "ALL",
  status: "ALL",
  chantierId: "ALL",
  sort: "RECENT",
};

describe("liste des projets de factures", () => {
  const rows = [
    draft({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      label: "Acompte Lyon",
      createdAt: "2026-10-01T10:00:00.000Z",
      clientName: "Études Bâtiment",
      chantierId: source.chantierId,
      status: "DRAFT",
      type: "DEPOSIT",
      amountHtCents: 54_000,
    }),
    draft({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      label: "Situation Grenoble",
      createdAt: "2026-10-02T10:00:00.000Z",
      clientName: "Jules SAS",
      affairName: "Grenoble",
      chantierId: otherSite,
      status: "APPROVED",
      type: "PROGRESS",
      amountHtCents: 120_000,
    }),
    draft({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      label: "Facture hors chantier",
      createdAt: "2026-10-03T10:00:00.000Z",
      clientName: "Alice",
      chantierId: null,
      status: "DRAFT",
      type: "STANDARD",
      amountHtCents: 10_000,
    }),
  ];
  it("recherche sans tenir compte des accents ni de la casse", () => {
    expect(filterBillingProjects(rows, { ...baseFilter, search: "ETUDES" })).toHaveLength(1);
    expect(filterBillingProjects(rows, { ...baseFilter, search: "grenoble" })).toHaveLength(1);
    expect(filterBillingProjects(rows, { ...baseFilter, search: "D-2026-101" })).toHaveLength(3);
    expect(filterBillingProjects(rows, { ...baseFilter, search: "inconnu" })).toHaveLength(0);
  });

  it("filtre par statut, type et chantier sans toucher aux sources", () => {
    expect(
      filterBillingProjects(rows, { ...baseFilter, status: "APPROVED" }).map((x) => x.id),
    ).toEqual([rows[1].id]);
    expect(
      filterBillingProjects(rows, { ...baseFilter, type: "DEPOSIT" }).map((x) => x.id),
    ).toEqual([rows[0].id]);
    expect(
      filterBillingProjects(rows, { ...baseFilter, chantierId: otherSite }).map((x) => x.id),
    ).toEqual([rows[1].id]);
    expect(
      filterBillingProjects(rows, { ...baseFilter, chantierId: "NONE" }).map((x) => x.id),
    ).toEqual([rows[2].id]);
  });

  it("trie par date, client et montant sans modifier l'ordre initial", () => {
    const original = rows.map((row) => row.id);
    expect(filterBillingProjects(rows, baseFilter).map((x) => x.id)).toEqual([
      rows[2].id,
      rows[1].id,
      rows[0].id,
    ]);
    expect(filterBillingProjects(rows, { ...baseFilter, sort: "OLDEST" }).map((x) => x.id)).toEqual(
      original,
    );
    expect(
      filterBillingProjects(rows, { ...baseFilter, sort: "AMOUNT_DESC" }).map((x) => x.id),
    ).toEqual([rows[1].id, rows[0].id, rows[2].id]);
    expect(filterBillingProjects(rows, { ...baseFilter, sort: "CLIENT" }).map((x) => x.id)).toEqual(
      [rows[2].id, rows[0].id, rows[1].id],
    );
    expect(rows.map((row) => row.id)).toEqual(original);
  });
});
