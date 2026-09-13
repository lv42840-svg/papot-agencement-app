import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CommercialCase } from "@/lib/commercial/domain";
import {
  parseChantiersPayload,
  type ChantierRecord,
  type ChantiersPayload,
} from "./domain";

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

function hasHistoricalDocument(item: CommercialCase, category: "QUOTE" | "COSTING"): boolean {
  return item.documents.some((document) => document.category === category);
}

export function launchChantierFromAffair(
  rawSource: ChantiersPayload,
  affair: CommercialCase,
  input: LaunchChantierFromAffairInput,
  actor: ChantierLaunchActor,
  now: Date = new Date(),
): { payload: ChantiersPayload; focusChantierId: string } {
  const payload = structuredClone(parseChantiersPayload(rawSource));

  if (affair.id !== input.commercialCaseId) throw new Error("CHANTIER_COMMERCIAL_CASE_MISMATCH");
  if (affair.status !== "CONFIRMED") throw new Error("CHANTIER_COMMERCIAL_NOT_CONFIRMED");
  if (!affair.plannedInstallDate) throw new Error("CHANTIER_INSTALL_DATE_REQUIRED");
  if (payload.chantiers.some((item) => item.sourceCommercialCaseId === affair.id)) {
    throw new Error("CHANTIER_ALREADY_LAUNCHED");
  }

  // A quote is deliberately NOT required to start a chantier in PAPOT V1.
  // Until the native Devis module is connected, historical OBAT documents are
  // displayed only as context and never block the operational launch.
  const historicalQuote = hasHistoricalDocument(affair, "QUOTE");
  const historicalCosting = hasHistoricalDocument(affair, "COSTING");
  const timestamp = now.toISOString();

  const item: ChantierRecord = {
    id: affair.id,
    sourceCommercialCaseId: affair.id,
    sourceEntryId: affair.sourceEntryId,
    number: null,
    reference: null,
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
    launchYear: now.getFullYear(),
    launchDocuments: {
      quote: historicalQuote ? "PRESENT" : "MISSING_DECLARED",
      signedQuote: "MISSING_DECLARED",
      costing: historicalCosting ? "PRESENT" : "MISSING_DECLARED",
    },
    signedQuoteReminder: false,
    plannedHours: { be: input.be, workshop: input.workshop, install: input.install },
    actualHours: { be: 0, workshop: 0, install: 0 },
    operational: { beItems: [], workshopItems: [], installItems: [] },
    launchedAt: timestamp,
    launchedByName: actor.displayName,
    completedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
    history: [
      {
        id: randomUUID(),
        type: "LAUNCHED",
        at: timestamp,
        actorName: actor.displayName,
        summary: `Chantier lancé depuis l’affaire. Charge initiale : BE ${input.be} h · Atelier ${input.workshop} h · Pose ${input.install} h. Aucun devis n’est requis pour lancer le chantier.`,
      },
    ],
  };

  payload.chantiers.unshift(item);
  return { payload, focusChantierId: item.id };
}
