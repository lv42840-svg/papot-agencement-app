import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILLING_TITLES,
  billingTitlesSchema,
  parseBillingPayload,
} from "../src/lib/billing/domain";
import { readFileSync } from "node:fs";

describe("paramétrage des intitulés de factures", () => {
  it("conserve un catalogue facultatif sans casser les anciens brouillons", () => {
    const legacy = parseBillingPayload({ schemaVersion: 1, drafts: [] });
    expect(legacy.invoiceTitles).toBeUndefined();
    expect(DEFAULT_BILLING_TITLES.length).toBeGreaterThan(0);

    const labels = ["Acompte travaux", "Situation chantier", "Facture de solde"];
    const saved = parseBillingPayload({ ...legacy, invoiceTitles: labels });
    expect(saved.invoiceTitles).toEqual(labels);
  });

  it("refuse les intitulés dupliqués ou vides", () => {
    expect(billingTitlesSchema.safeParse(["Situation", "situation"]).success).toBe(false);
    expect(billingTitlesSchema.safeParse([""]).success).toBe(false);
    expect(billingTitlesSchema.safeParse([]).success).toBe(false);
  });

  it("affiche un choix dans le projet et l'historique des acomptes/situations antérieurs", () => {
    const editor = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    expect(editor).toContain("Intitulé de la facture");
    expect(editor).toContain("availableTitles.map");
    expect(editor).toContain("/settings/billing");
    expect(editor).toContain("Déjà préparé sur ce devis");
    expect(editor).toContain("item.quoteId === draft.quoteId");
    expect(editor).toContain("Validé en interne");
    const settings = readFileSync("src/components/billing-titles-settings.tsx", "utf8");
    expect(settings).toContain("SET_TITLES");
    expect(settings).toContain("Ajouter un intitulé");
    const api = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    expect(api).toContain('z.literal("SET_TITLES")');
    expect(api).toContain("...current, drafts");
    expect(api).toContain("...current, invoiceTitles");
  });
});
