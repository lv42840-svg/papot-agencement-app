import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/desktop/billing/route";
import { GET as getMarkets } from "@/app/api/desktop/billing/markets/route";
import { POST as issueInvoice } from "@/app/api/desktop/billing/issue/route";
import { createBillingDraft, type BillingPayload, type BillingSource } from "@/lib/billing/domain";
import { buildBillingSourceForChantier } from "@/lib/billing/market-sources";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  loadBilling: vi.fn(),
  mutate: vi.fn(),
  quotes: vi.fn(),
  chantiers: vi.fn(),
  commercial: vi.fn(),
  clients: vi.fn(),
  company: vi.fn(),
  authorizeIssue: vi.fn(),
  issue: vi.fn(),
  getPdf: vi.fn(),
  storePdf: vi.fn(),
}));

vi.mock("@/lib/desktop/request-context", () => ({
  requireModuleRequestContext: mocks.context,
  desktopRequestErrorStatus: (code: string) =>
    code === "MODULE_FORBIDDEN" ? 403 : code === "AUTH_REQUIRED" ? 401 : null,
}));
vi.mock("@/lib/auth/permissions", () => ({
  hasSpecialPermission: vi.fn(),
  requireSpecialPermission: mocks.authorizeIssue,
}));
vi.mock("@/lib/billing/repository", () => ({
  createBillingRepository: () => ({ load: mocks.loadBilling, mutate: mocks.mutate }),
}));
vi.mock("@/lib/billing/sources", () => ({ loadBillingSources: mocks.quotes }));
vi.mock("@/lib/chantiers/create-repository", () => ({
  createChantiersRepository: () => ({ load: mocks.chantiers }),
}));
vi.mock("@/lib/commercial/create-repository", () => ({
  createCommercialRepository: () => ({ load: mocks.commercial }),
}));
vi.mock("@/lib/clients/create-repository", () => ({
  createClientsRepository: () => ({ load: mocks.clients }),
}));
vi.mock("@/lib/company-profile/create-repository", () => ({
  createCompanyProfileRepository: () => ({ load: mocks.company }),
}));
vi.mock("@/lib/billing/native-issuance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/native-issuance")>()),
  issueNativeInvoice: mocks.issue,
}));
vi.mock("@/lib/billing/native-invoice-pdf", () => ({ generateNativeInvoicePdf: vi.fn() }));
vi.mock("@/lib/billing/native-pdf-archive", () => ({
  loadOriginalNativeInvoicePdf: mocks.getPdf,
  storeOriginalNativeInvoicePdf: mocks.storePdf,
}));

const uuid = () => crypto.randomUUID();
const time = "2026-11-23T10:00:00.000Z";
const clientId = uuid();
const conflicted = {
  id: uuid(),
  sourceCommercialCaseId: uuid(),
  name: "Chantier test en conflit",
  clientName: "TEST",
};
const healthy = {
  id: uuid(),
  sourceCommercialCaseId: uuid(),
  name: "Chantier sain",
  clientName: "Client",
};
const manualOnly = {
  id: uuid(),
  sourceCommercialCaseId: uuid(),
  name: "Sans devis",
  clientName: "Client",
};
const quote = (site: typeof conflicted, n: number): BillingSource => ({
  quoteId: uuid(),
  chantierId: site.id,
  commercialCaseId: site.sourceCommercialCaseId,
  clientId,
  clientName: site.clientName,
  affairName: site.name,
  quoteLabel: "Devis retenu",
  contractHtCents: n,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: n }],
  lines: [{ lineId: uuid(), description: "Travaux", amountHtCents: n, vatRatePercent: 20 }],
});
const conflictingQuote = quote(conflicted, 250_000);
const healthyQuote = quote(healthy, 50_000);
const manual = (site: typeof conflicted, amountHtCents = 20_000) => ({
  chantierId: site.id,
  commercialCaseId: site.sourceCommercialCaseId,
  clientId,
  clientName: site.clientName,
  description: "Travaux déjà représentés dans le devis",
  lineId: uuid(),
  amountHtCents,
  vatRatePercent: 20,
  createdAt: time,
  createdByName: "Test",
});
const manualConflict = manual(conflicted, 200_000);
const empty: BillingPayload = { schemaVersion: 1, drafts: [] };
const request = (body: unknown) =>
  new Request("http://localhost/api/desktop/billing", {
    method: "POST",
    body: JSON.stringify(body),
  });
let stored: BillingPayload;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  const draft = createBillingDraft(
    empty,
    buildBillingSourceForChantier(conflicted, [], [manualConflict])!,
    { requestId: uuid(), type: "STANDARD" },
    "Test",
    new Date(time),
  );
  stored = {
    schemaVersion: 1,
    drafts: [draft],
    manualMarkets: [manualConflict, manual(manualOnly)],
  };
  mocks.context.mockResolvedValue({
    user: { id: uuid(), displayName: "Test" },
    moduleAccess: { canWrite: true },
  });
  mocks.loadBilling.mockImplementation(async () => stored);
  mocks.mutate.mockImplementation(async (fn) => {
    const next = await fn(structuredClone(stored));
    stored = next;
    return next;
  });
  mocks.quotes.mockResolvedValue([conflictingQuote, healthyQuote]);
  mocks.chantiers.mockResolvedValue({ chantiers: [conflicted, healthy, manualOnly] });
  mocks.clients.mockResolvedValue({ clients: [{ id: clientId }] });
  mocks.company.mockResolvedValue({});
});

describe("isoler un marché ambigü sans perdre les projets", () => {
  it("ouvre la facturation, liste le projet le chantier en conflit sans le compter deux fois et garde les autres marchés", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.marketIssues).toEqual([
      {
        chantierId: conflicted.id,
        quoteIds: [conflictingQuote.quoteId],
        code: "BILLING_MARKET_SOURCE_CONFLICT",
      },
    ]);
    expect(
      data.sources.map((source: BillingSource) => [source.chantierId, source.contractHtCents]),
    ).toEqual([
      [healthy.id, 50_000],
      [manualOnly.id, 20_000],
    ]);
    expect(data.payload.drafts).toEqual(stored.drafts);
    expect(data.payload.manualMarkets).toEqual(stored.manualMarkets);
    expect(data.issuedInvoices).toEqual([]);
    expect(data.canIssue).toBe(false);
    const summary = await (await getMarkets()).json();
    expect(summary.marketIssues).toEqual(data.marketIssues);
    expect(summary.markets.map((market: { chantierId: string }) => market.chantierId)).toEqual([
      healthy.id,
      manualOnly.id,
    ]);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("bloque uniquement la création du chantier en conflit et préserve les deux parcours sains", async () => {
    const create = (site: typeof conflicted, requestId = uuid()) =>
      POST(
        request({
          action: "CREATE",
          requestId,
          quoteId: site.id,
          chantierId: site.id,
          type: "STANDARD",
        }),
      );
    const response = await create(conflicted);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "BILLING_MARKET_SOURCE_CONFLICT" });
    expect(stored.drafts).toHaveLength(1);
    const retry = uuid();
    expect((await create(healthy, retry)).status).toBe(200);
    expect((await create(healthy, retry)).status).toBe(200);
    expect((await create(manualOnly)).status).toBe(200);
    expect(stored.drafts.map((item) => item.chantierId)).toEqual([
      conflicted.id,
      healthy.id,
      manualOnly.id,
    ]);
    expect(new Set(stored.drafts.map((item) => item.id)).size).toBe(3);
    expect(stored.nativeInvoiceLedger).toBeUndefined();
  });

  it("ajoute un supplément confirmé sur un chantier sain sans toucher à le chantier en conflit", async () => {
    const originalConflict = structuredClone(stored.drafts[0]);
    const response = await POST(
      request({
        action: "ADD_EXTRA",
        requestId: uuid(),
        chantierId: healthy.id,
        description: "Prestation supplémentaire distincte",
        amountHtCents: 1_500,
        vatRatePercent: 20,
      }),
    );
    expect(response.status).toBe(200);
    const extra = stored.extras?.[0];
    expect(extra?.agreementStatus).toBe("TO_CONFIRM");
    expect(
      (
        await POST(
          request({
            action: "CONFIRM_EXTRA",
            extraId: extra?.id,
            evidence: "Bon pour accord",
          }),
        )
      ).status,
    ).toBe(200);
    const data = await (await GET()).json();
    expect(
      data.sources.find((source: BillingSource) => source.chantierId === healthy.id)
        .contractHtCents,
    ).toBe(51_500);
    expect(stored.drafts[0]).toEqual(originalConflict);
  });

  it("laisse les droits et le registre officiels protégés", async () => {
    mocks.context.mockRejectedValueOnce(new Error("MODULE_FORBIDDEN"));
    expect((await GET()).status).toBe(403);
    expect(mocks.loadBilling).not.toHaveBeenCalled();
    const draft = stored.drafts[0];
    expect(
      (await POST(request({ action: "APPROVE", draftId: draft.id, expectedUpdatedAt: time })))
        .status,
    ).toBe(409);
    expect(stored.drafts[0].status).toBe("DRAFT");

    vi.stubEnv("PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED", "true");
    const response = await issueInvoice(
      request({
        requestId: uuid(),
        draftId: draft.id,
        expectedUpdatedAt: time,
        serviceOn: "2026-11-23",
        dueOn: "2026-12-23",
        operationCategory: "SERVICE",
        vatOnDebits: false,
        buyerPurchaseOrderNumber: "",
        latePenaltyRatePercent: 5,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "BILLING_MARKET_SOURCE_CONFLICT" });
    expect(mocks.authorizeIssue).toHaveBeenCalledWith(expect.anything(), "billing.issue_invoices");
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.storePdf).not.toHaveBeenCalled();
    expect(stored.nativeInvoiceLedger).toBeUndefined();
  });

  it("écarte également un ancien projet dont le montant dépasse le marché actuel", async () => {
    const larger = quote(healthy, 80_000);
    const draft = createBillingDraft(
      empty,
      buildBillingSourceForChantier(healthy, [larger], [])!,
      { requestId: uuid(), type: "STANDARD" },
      "Test",
      new Date(time),
    );
    stored.drafts.push(draft);
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(
      data.marketIssues.find((issue: { chantierId: string }) => issue.chantierId === healthy.id)
        ?.code,
    ).toBe("BILLING_PREPARATION_EXCEEDS_CONTRACT");
    expect(data.payload.drafts).toEqual(stored.drafts);
    expect(data.sources.map((source: BillingSource) => source.chantierId)).toEqual([manualOnly.id]);
  });

  it("retire seulement le marché manuel en doublon après confirmation, sans documents liés", async () => {
    stored.drafts = [];
    const before = await (await GET()).json();
    const resolution = before.manualMarketResolutions[0];
    expect(resolution.manual.amountHtCents).toBe(200_000);
    expect(resolution.retainedQuotes).toEqual([
      { id: conflictingQuote.quoteId, label: conflictingQuote.quoteLabel, amountHtCents: 250_000 },
    ]);
    expect(resolution.blockedByDocuments).toBe(false);
    const response = await POST(
      request({
        action: "REMOVE_DUPLICATE_MANUAL_MARKET",
        chantierId: conflicted.id,
        manualVersion: resolution.manual.version,
        retainedVersion: resolution.retainedVersion,
        confirmed: true,
      }),
    );
    expect(response.status).toBe(200);
    const replay = await POST(
      request({
        action: "REMOVE_DUPLICATE_MANUAL_MARKET",
        chantierId: conflicted.id,
        manualVersion: resolution.manual.version,
        retainedVersion: resolution.retainedVersion,
        confirmed: true,
      }),
    );
    expect(replay.status).toBe(409);
    expect(stored.manualMarkets?.map((market) => market.chantierId)).toEqual([manualOnly.id]);
    expect(stored.drafts).toEqual([]);
    const after = await (await GET()).json();
    expect(after.marketIssues).toEqual([]);
    expect(
      after.sources.find((item: BillingSource) => item.chantierId === conflicted.id)
        .contractHtCents,
    ).toBe(250_000);
    expect(
      after.sources.find((item: BillingSource) => item.chantierId === healthy.id).contractHtCents,
    ).toBe(50_000);
  });

  it("refuse une confirmation absente, une autre fiche ou un montant modifié depuis l'affichage", async () => {
    stored.drafts = [];
    const resolution = (await (await GET()).json()).manualMarketResolutions[0];
    const action = {
      action: "REMOVE_DUPLICATE_MANUAL_MARKET",
      chantierId: conflicted.id,
      manualVersion: resolution.manual.version,
      retainedVersion: resolution.retainedVersion,
      confirmed: true,
    };
    expect((await POST(request({ ...action, confirmed: false }))).status).toBe(400);
    expect((await POST(request({ ...action, chantierId: healthy.id }))).status).toBe(409);
    mocks.quotes.mockResolvedValueOnce([
      { ...conflictingQuote, contractHtCents: 250_001 },
      healthyQuote,
    ]);
    expect((await POST(request(action))).status).toBe(409);
    stored.manualMarkets![0] = { ...manualConflict, amountHtCents: 200_001 };
    expect((await POST(request(action))).status).toBe(409);
    expect(stored.manualMarkets).toHaveLength(2);

    mocks.context.mockRejectedValueOnce(new Error("MODULE_FORBIDDEN"));
    expect((await POST(request(action))).status).toBe(403);
    expect(mocks.context).toHaveBeenLastCalledWith("billing", "WRITE");
  });

  it("refuse le retrait avec un ancien projet portant seulement un alias ou la ligne manuelle", async () => {
    const original = stored.drafts[0];
    const resolution = (await (await GET()).json()).manualMarketResolutions[0];
    expect(resolution.blockedByDocuments).toBe(true);
    const action = {
      action: "REMOVE_DUPLICATE_MANUAL_MARKET",
      chantierId: conflicted.id,
      manualVersion: resolution.manual.version,
      retainedVersion: resolution.retainedVersion,
      confirmed: true,
    };
    for (const draft of [
      original,
      {
        ...original,
        chantierId: null,
        quoteId: conflictingQuote.quoteId,
        lines: [],
        documentLines: [],
      },
      {
        ...original,
        chantierId: healthy.id,
        quoteId: healthyQuote.quoteId,
        lines: [],
        structure: [],
        documentLines: [
          {
            ...original.documentLines!.find((line) => line.sourceLineId === manualConflict.lineId)!,
          },
        ],
      },
    ]) {
      stored.drafts = [draft];
      const response = await POST(request(action));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "BILLING_MANUAL_MARKET_HAS_DOCUMENTS" });
      expect(stored.drafts).toEqual([draft]);
      expect(stored.manualMarkets?.[0]).toEqual(manualConflict);
    }
  });

  it("ne masque pas une panne générale en tant que simple conflit de chantier", async () => {
    mocks.loadBilling.mockRejectedValueOnce(new Error("STORAGE_UNAVAILABLE"));
    const response = await GET();
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ error: "STORAGE_UNAVAILABLE" });
  });
});
