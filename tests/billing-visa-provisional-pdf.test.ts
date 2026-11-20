import { describe, expect, it } from "vitest";
import { assertPdfBuffer } from "../src/lib/documents/pdf-runtime";
import { generateBillingVisaProvisionalPdf } from "../src/lib/billing/visa-provisional-pdf";
import {
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import { presentBillingVisa, recordBillingVisaDecision } from "../src/lib/billing/visa";
import { setBillingDraftRetention } from "../src/lib/billing/draft-retention";

const site = "11111111-1111-4111-8111-111111111111";
const lineId = "22222222-2222-4222-8222-222222222222";
const source: BillingSource = {
  quoteId: "33333333-3333-4333-8333-333333333333",
  commercialCaseId: "44444444-4444-4444-8444-444444444444",
  chantierId: site,
  clientId: "55555555-5555-4555-8555-555555555555",
  clientName: "Client Pralus",
  affairName: "Boutique Pralus",
  quoteLabel: "D-2026-001",
  contractHtCents: 10_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 10_000 }],
  lines: [
    { lineId, description: "Agencement et finitions", amountHtCents: 10_000, vatRatePercent: 20 },
  ],
};
const base = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const prepare = () => {
  const draft = createBillingDraft(
    base(),
    source,
    { requestId: crypto.randomUUID(), type: "STANDARD" },
    "Nadia",
  );
  return presentBillingVisa(
    { ...base(), drafts: [draft] },
    {
      draftId: draft.id,
      expectedUpdatedAt: draft.updatedAt,
      submittedTo: "Architecte",
      submittedNotes: "Validation de la situation",
    },
    "Nadia",
  );
};

describe("PDF des versions de visa provisoires", () => {
  it("contient tous les identifiants provisoires sans numéro légal ni mutation", () => {
    const payload = prepare();
    const draft = payload.drafts[0];
    const visa = payload.visaVersions![0];
    const before = JSON.stringify(payload);
    const bytes = generateBillingVisaProvisionalPdf(visa, draft);
    assertPdfBuffer(bytes);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("PRESENTATION PROVISOIRE - VERSION V1");
    expect(text).toContain("DOCUMENT DE VALIDATION - NON FACTURE / SANS NUMERO LEGAL");
    expect(text).toContain("Client Pralus");
    expect(text).toContain("Boutique Pralus");
    expect(text).toContain("Agencement et finitions");
    expect(text).toContain("TOTAL TTC");
    expect(text).not.toContain("NUMERO DE FACTURE");
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("affiche les conditions archivées de retenue sur le PDF provisoire", () => {
    const draft = createBillingDraft(
      base(),
      source,
      { requestId: crypto.randomUUID(), type: "STANDARD" },
      "Nadia",
    );
    const withRetention = setBillingDraftRetention(
      { ...base(), drafts: [draft] },
      {
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        mode: "PERCENT",
        value: 5,
      },
      "Nadia",
    );
    const visa = presentBillingVisa(
      withRetention,
      {
        draftId: draft.id,
        expectedUpdatedAt: withRetention.drafts[0].updatedAt,
        submittedTo: "Architecte",
        submittedNotes: "Version avec retenue",
      },
      "Nadia",
    );
    const text = Buffer.from(
      generateBillingVisaProvisionalPdf(visa.visaVersions![0], visa.drafts[0]),
    ).toString("latin1");
    expect(text).toContain("RETENUE GARANTIE TTC (5 %) : 6,00 EUR");
    expect(text).toContain("PART TTC HORS RETENUE : 114,00 EUR");
    expect(text).toContain("NON FACTURE");
  });

  it("rend exactement la même présentation après sa décision extérieure", () => {
    const payload = prepare();
    const draft = payload.drafts[0];
    const original = generateBillingVisaProvisionalPdf(payload.visaVersions![0], draft);
    const accepted = recordBillingVisaDecision(
      payload,
      {
        draftId: draft.id,
        version: 1,
        decision: "ACCEPTED",
        reviewMethod: "EMAIL",
        externalContact: "Architecte",
        evidence: "Accord enregistré",
        reason: "Validé",
      },
      "Lucien",
    );
    const after = generateBillingVisaProvisionalPdf(accepted.visaVersions![0], draft);
    expect(Buffer.from(after).equals(Buffer.from(original))).toBe(true);
  });

  it("pagine les situations longues et conserve tous les ouvrages", () => {
    const payload = prepare();
    const draft = payload.drafts[0];
    const visa = payload.visaVersions![0];
    const lines = Array.from({ length: 105 }, (_, index) => ({
      ...visa.documentLines[0],
      id: crypto.randomUUID(),
      description: `Ouvrage test ligne ${String(index + 1).padStart(3, "0")}`,
    }));
    const bulkVisa = {
      ...visa,
      documentLines: lines,
    };
    const data = Buffer.from(generateBillingVisaProvisionalPdf(bulkVisa, draft)).toString("latin1");
    expect(data).toContain("Ouvrage test ligne 001");
    expect(data).toContain("Ouvrage test ligne 105");
    const count = Number(data.match(/\/Type \/Pages \/Count (\d+)/)?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(data).toContain("Page 1/");
    expect(data).toContain("PROVISOIRE - NON FACTURE - AUCUN ENVOI PENNYLANE");
  });

  it("interrompt une exportation disproportionnée pour protéger le serveur", () => {
    const payload = prepare();
    const draft = payload.drafts[0];
    const visa = payload.visaVersions![0];
    const description = Array.from({ length: 180 }, (_, index) => `Prestation${index}`).join(" ");
    const bulk = {
      ...visa,
      documentLines: Array.from({ length: 250 }, (_, index) => ({
        ...visa.documentLines[0],
        id: crypto.randomUUID(),
        description: `${description} - ligne ${index}`,
      })),
    };
    expect(() => generateBillingVisaProvisionalPdf(bulk, draft)).toThrow(
      "BILLING_VISA_PDF_PAGE_LIMIT",
    );
  });

  it("interdit le PDF d'un brouillon qui ne correspond pas à la version", () => {
    const payload = prepare();
    const visa = payload.visaVersions![0];
    expect(() =>
      generateBillingVisaProvisionalPdf(visa, {
        ...payload.drafts[0],
        id: "77777777-7777-4777-8777-777777777777",
      }),
    ).toThrow("BILLING_VISA_DRAFT_MISMATCH");
  });
  it("garde le nom historique du client et du chantier si le brouillon change", () => {
    const payload = prepare();
    const draft = payload.drafts[0];
    const visa = payload.visaVersions![0];
    const original = generateBillingVisaProvisionalPdf(visa, draft);
    const modified = generateBillingVisaProvisionalPdf(visa, {
      id: draft.id,
    });
    expect(Buffer.from(modified).equals(Buffer.from(original))).toBe(true);
    expect(visa.clientName).toBe("Client Pralus");
    expect(visa.chantierName).toBe("Boutique Pralus");
  });

  it("pagine une seule description de 4 000 caractères sans la tronquer", () => {
    const payload = prepare();
    const draft = payload.drafts[0];
    const visa = payload.visaVersions![0];
    const description = Array.from(
      { length: 120 },
      (_, i) => `Segment${String(i).padStart(3, "0")}`,
    ).join(" ");
    const extended = {
      ...visa,
      documentLines: [{ ...visa.documentLines[0], description }],
    };
    const pdf = Buffer.from(generateBillingVisaProvisionalPdf(extended, draft)).toString("latin1");
    expect(pdf).toContain("Segment000");
    expect(pdf).toContain("Segment119");
    expect(Number(pdf.match(/\/Type \/Pages \/Count (\d+)/)?.[1])).toBeGreaterThan(1);
  });
});
