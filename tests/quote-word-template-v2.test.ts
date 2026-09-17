import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const templatePath = new URL(
  "../docs/templates/PAPOT_Template_Devis_V2.docx",
  import.meta.url,
);
const manifestPath = new URL(
  "../docs/templates/PAPOT_Template_Devis_V2.manifest.json",
  import.meta.url,
);

type QuoteWordTemplateManifest = {
  templateVersion: number;
  scalarTokens: string[];
  dynamicAnchors: Record<string, string>;
  layoutRules: string[];
  requiredBeforePdf: string[];
  generationOrder: string[];
};

const manifest = JSON.parse(
  readFileSync(manifestPath, "utf-8"),
) as QuoteWordTemplateManifest;

describe("quote Word template V2", () => {
  it("est un vrai document DOCX versionne", () => {
    const template = readFileSync(templatePath);
    expect(template.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(manifest.templateVersion).toBe(2);
  });

  it("porte les donnees obligatoires avant generation PDF", () => {
    expect(manifest.requiredBeforePdf).toEqual(
      expect.arrayContaining([
        "devis_numero",
        "devis_date",
        "devis_validite",
        "travaux_debut",
        "travaux_duree",
        "travaux_fin_limite",
        "client_raison_sociale",
        "conditions_paiement",
      ]),
    );
  });

  it("prevoit le contenu client dynamique sans exposer les ajustements internes", () => {
    expect(Object.keys(manifest.dynamicAnchors)).toEqual(
      expect.arrayContaining([
        "PAPOT_QUOTE_BODY",
        "PAPOT_OPTIONS_BLOCK",
        "PAPOT_VAT_SUMMARY",
        "PAPOT_VAT_LINES_ANCHOR",
        "PAPOT_ANNEX_IMAGES",
      ]),
    );
    expect(manifest.layoutRules).toContain(
      "Internal pricing adjustments are never rendered as separate client rows.",
    );
    expect(manifest.layoutRules).toContain(
      "Options are visually separated and excluded from total_ht/total_ttc/net_a_payer.",
    );
  });

  it("conserve les donnees de devis utiles au futur generateur", () => {
    expect(manifest.scalarTokens).toEqual(
      expect.arrayContaining([
        "affaire_nom",
        "chantier_ville",
        "conditions_paiement",
        "total_ht",
        "total_ttc",
        "net_a_payer",
      ]),
    );
    expect(manifest.generationOrder.at(-1)).toBe("convert DOCX to PDF");
  });
});
