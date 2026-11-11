import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CommercialCase } from "@/lib/commercial/domain";
import { parseChantiersPayload, type ChantierRecord, type ChantiersPayload } from "./domain";

export const launchChantierFromAffairSchema = z.object({
  commercialCaseId: z.string().uuid(),
  be: z.number().min(0).max(100000),
  workshop: z.number().min(0).max(100000),
  install: z.number().min(0).max(100000),
  quoteMissingDeclared: z.boolean().optional(),
  signedQuoteMissingDeclared: z.boolean().optional(),
  costingMissingDeclared: z.boolean().optional(),
});

export type LaunchChantierFromAffairInput = z.infer<typeof launchChantierFromAffairSchema>;
export type ChantierLaunchActor = { userId: string; displayName: string };

function hasHistoricalDocument(element: CommercialCase, category: "QUOTE" | "COSTING"): boolean {
  return element.documents.some((document) => document.category === category);
}

export function launchChantierFromAffair(
  rawSource: ChantiersPayload,
  affair: CommercialCase,
  saisie: LaunchChantierFromAffairInput,
  auteur: ChantierLaunchActor,
  maintenant: Date = new Date(),
): { payload: ChantiersPayload; focusChantierId: string } {
  const contenu = structuredClone(parseChantiersPayload(rawSource));

  if (affair.id !== saisie.commercialCaseId) throw new Error("CHANTIER_COMMERCIAL_CASE_MISMATCH");
  if (affair.status !== "CONFIRMED") throw new Error("CHANTIER_COMMERCIAL_NOT_CONFIRMED");
  if (!affair.plannedInstallDate) throw new Error("CHANTIER_INSTALL_DATE_REQUIRED");
  if (contenu.chantiers.some((element) => element.sourceCommercialCaseId === affair.id)) {
    throw new Error("CHANTIER_ALREADY_LAUNCHED");
  }

  // A quote is deliberately NOT required to start a chantier in PAPOT V1.
  // Native retained quotes are now the primary commercial source. Historical
  // documents remain valid context for older affairs.
  const historicalQuote = hasHistoricalDocument(affair, "QUOTE");
  const nativeQuote = affair.retainedQuoteIds.length > 0;
  const historicalCosting = hasHistoricalDocument(affair, "COSTING");
  const timestamp = maintenant.toISOString();
  const launchYear = maintenant.getFullYear();
  const existingNumbers = contenu.chantiers
    .filter((candidat) => candidat.launchYear === launchYear)
    .map((candidat) => candidat.number)
    .filter((valeur): valeur is string => Boolean(valeur))
    .map((valeur) => Number(valeur.split("-").at(-1)))
    .filter((valeur) => Number.isInteger(valeur) && valeur > 0);
  const nextSequence = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  const chantierNumber = `${launchYear}-${String(nextSequence).padStart(3, "0")}`;

  const element: ChantierRecord = {
    id: affair.id,
    sourceCommercialCaseId: affair.id,
    sourceEntryId: affair.sourceEntryId,
    initialRetainedQuoteIds: [...affair.retainedQuoteIds],
    number: chantierNumber,
    reference: affair.name,
    name: affair.name,
    clientName: affair.clientName,
    companyName: null,
    siteLabel: affair.siteLabel,
    contactName: affair.contactName,
    contactPhone: affair.contactPhone,
    contactEmail: affair.contactEmail,
    description: affair.description,
    nextAction: affair.nextAction,
    status: "ACTIVE",
    plannedInstallDate: affair.plannedInstallDate,
    launchYear,
    launchDocuments: {
      quote: nativeQuote || historicalQuote ? "PRESENT" : "MISSING_DECLARED",
      signedQuote: "MISSING_DECLARED",
      costing: historicalCosting ? "PRESENT" : "MISSING_DECLARED",
    },
    signedQuoteReminder: false,
    plannedHours: { be: saisie.be, workshop: saisie.workshop, install: saisie.install },
    actualHours: { be: 0, workshop: 0, install: 0 },
    operational: {
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
    },
    launchedAt: timestamp,
    launchedByName: auteur.displayName,
    completedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
    history: [
      {
        id: randomUUID(),
        type: "LAUNCHED",
        at: timestamp,
        actorName: auteur.displayName,
        summary: `Chantier lancé depuis l’affaire. Charge initiale : BE ${saisie.be} h · Atelier ${saisie.workshop} h · Pose ${saisie.install} h. ${affair.retainedQuoteIds.length} devis natif${affair.retainedQuoteIds.length > 1 ? "s" : ""} retenu${affair.retainedQuoteIds.length > 1 ? "s" : ""} lié${affair.retainedQuoteIds.length > 1 ? "s" : ""} au chantier.`,
      },
    ],
  };

  contenu.chantiers.unshift(element);
  return { payload: contenu, focusChantierId: element.id };
}
