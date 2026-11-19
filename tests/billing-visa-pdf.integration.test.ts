import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  comparePdfVisualRenders,
  renderPdfToPngPages,
} from "../src/lib/documents/pdf-runtime";
import {
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import { presentBillingVisa } from "../src/lib/billing/visa";
import { generateBillingVisaProvisionalPdf } from "../src/lib/billing/visa-provisional-pdf";

const integration = process.env.PAPOT_RUN_PDF_INTEGRATION === "1" ? describe : describe.skip;
const lineId = "11111111-1111-4111-8111-111111111111";
const source: BillingSource = {
  quoteId: "22222222-2222-4222-8222-222222222222",
  commercialCaseId: "33333333-3333-4333-8333-333333333333",
  chantierId: "44444444-4444-4444-8444-444444444444",
  clientId: "55555555-5555-4555-8555-555555555555",
  clientName: "Pralus Manufacture",
  affairName: "Boutique Bourg-en-Bresse",
  quoteLabel: "D-2026-PROV",
  contractHtCents: 540_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 540_000 }],
  lines: [{ lineId, description: "Ouvrage de mobilier", amountHtCents: 540_000, vatRatePercent: 20 }],
};

function createPreview() {
  const empty: BillingPayload = { schemaVersion: 1, drafts: [] };
  const draft = createBillingDraft(
    empty,
    source,
    { requestId: crypto.randomUUID(), type: "PROGRESS", cumulativePercent: 40 },
    "Nadia",
  );
  const payload = presentBillingVisa(
    { ...empty, drafts: [draft] },
    {
      draftId: draft.id,
      expectedUpdatedAt: draft.updatedAt,
      submittedTo: "Architecte",
      submittedNotes: "Visa de la situation provisoire",
    },
    "Lucien",
  );
  return { draft, version: payload.visaVersions![0] };
}

async function writeArtifacts(label: string, pdf: Uint8Array, pages: Uint8Array[]) {
  const base = process.env.PAPOT_PDF_ARTIFACT_DIR?.trim();
  if (!base) return;
  const dir = path.resolve(base);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `billing-visa-${label}.pdf`), pdf);
  await Promise.all(
    pages.map((page, i) =>
      writeFile(path.join(dir, `billing-visa-${label}-page-${i + 1}.png`), page),
    ),
  );
}

integration("PDF provisoire des situations : vérification Poppler", () => {
  it("rend les ouvrages et le filigrane sur des pages A4 réellement ouvrables", async () => {
    const { draft, version } = createPreview();
    const lines = Array.from({ length: 54 }, (_, index) => ({
      ...version.documentLines[0],
      id: crypto.randomUUID(),
      description: `Mobilier complémentaire - prestation détaillée ${index + 1}`,
    }));
    const pdf = generateBillingVisaProvisionalPdf({ ...version, documentLines: lines }, draft);
    const pages = await renderPdfToPngPages(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(Buffer.from(pages[0]).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await writeArtifacts("multiple-pages", pdf, pages);

    const altered = generateBillingVisaProvisionalPdf(
      { ...version, documentLines: lines, version: 2 },
      draft,
    );
    const difference = await comparePdfVisualRenders(pdf, altered);
    expect(difference.matches).toBe(false);
    expect(difference.changedPages).toContain(1);
  }, 120_000);

  it("n'écrase pas le pied de page pour une description unique très longue", async () => {
    const { draft, version } = createPreview();
    const extended = {
      ...version,
      documentLines: [
        {
          ...version.documentLines[0],
          description: Array.from({ length: 160 }, (_, i) => `Prestation-${i}`).join(" "),
        },
      ],
    };
    const pdf = generateBillingVisaProvisionalPdf(extended, draft);
    const pages = await renderPdfToPngPages(pdf);
    expect(pages.length).toBeGreaterThan(1);
    await writeArtifacts("long-description", pdf, pages);
  }, 120_000);
});
