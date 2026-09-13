import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commercialHasSignedQuote, type CommercialCase } from "@/lib/commercial/domain";
import {
  CHANTIER_STATUS_LABELS,
  parseChantiersPayload,
  type ChantierRecord,
  type ChantiersPayload,
} from "./domain";

const nullableText = (max: number) => z.string().trim().max(max).optional().default("");

export const launchChantierSchema = z.object({
  commercialCaseId: z.string().uuid(),
  quoteMissingDeclared: z.boolean().default(false),
  signedQuoteMissingDeclared: z.boolean().default(false),
  costingMissingDeclared: z.boolean().default(false),
  be: z.number().min(0).max(100000),
  workshop: z.number().min(0).max(100000),
  install: z.number().min(0).max(100000),
});

export const chantierMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("updateDetails"),
    chantierId: z.string().uuid(),
    number: nullableText(80),
    reference: nullableText(160),
    name: z.string().trim().min(1).max(240),
    clientName: nullableText(240),
    companyName: nullableText(240),
    siteLabel: nullableText(240),
    contactName: nullableText(160),
    contactPhone: nullableText(80),
    contactEmail: nullableText(240),
    description: nullableText(4000),
    nextAction: nullableText(2000),
  }),
  z.object({
    action: z.literal("updatePlannedHours"),
    chantierId: z.string().uuid(),
    be: z.number().min(0).max(100000),
    workshop: z.number().min(0).max(100000),
    install: z.number().min(0).max(100000),
    reason: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("markDone"),
    chantierId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reactivate"),
    chantierId: z.string().uuid(),
    reason: z.string().trim().max(2000).optional().default(""),
  }),
  z.object({
    action: z.literal("archive"),
    chantierId: z.string().uuid(),
    openItemsReviewed: z.literal(true),
  }),
  z.object({
    action: z.literal("unarchive"),
    chantierId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
  }),
]);

export type LaunchChantierInput = z.infer<typeof launchChantierSchema>;
export type ChantierMutation = z.infer<typeof chantierMutationSchema>;
export type ChantierActor = { userId: string; displayName: string };
export type ChantierMutationResult = { payload: ChantiersPayload; focusChantierId?: string };

export type ChantierCapabilities = {
  canRead: boolean;
  canModify: boolean;
  canLaunch: boolean;
  canArchive: boolean;
};

export function chantierCapabilities(_actor: ChantierActor): ChantierCapabilities {
  return { canRead: true, canModify: true, canLaunch: true, canArchive: true };
}

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function findChantier(payload: ChantiersPayload, chantierId: string): ChantierRecord {
  const item = payload.chantiers.find((candidate) => candidate.id === chantierId);
  if (!item) throw new Error("CHANTIER_NOT_FOUND");
  return item;
}

function history(
  item: ChantierRecord,
  actorName: string,
  type: ChantierRecord["history"][number]["type"],
  summary: string,
  now: Date,
): void {
  item.history.push({ id: randomUUID(), type, at: now.toISOString(), actorName, summary });
}

function touch(item: ChantierRecord, actor: ChantierActor, now: Date): void {
  item.updatedAt = now.toISOString();
  item.updatedByName = actor.displayName;
}

function hasDocument(item: CommercialCase, category: "QUOTE" | "COSTING"): boolean {
  return item.documents.some((document) => document.category === category);
}

export function launchChantierFromCommercial(
  rawSource: ChantiersPayload,
  commercialCase: CommercialCase,
  input: LaunchChantierInput,
  actor: ChantierActor,
  now: Date = new Date(),
): ChantierMutationResult {
  const source = parseChantiersPayload(rawSource);
  const payload = structuredClone(source);

  if (commercialCase.id !== input.commercialCaseId) throw new Error("CHANTIER_COMMERCIAL_CASE_MISMATCH");
  if (commercialCase.status !== "CONFIRMED") throw new Error("CHANTIER_COMMERCIAL_NOT_CONFIRMED");
  if (!commercialCase.plannedInstallDate) throw new Error("CHANTIER_INSTALL_DATE_REQUIRED");
  if (payload.chantiers.some((item) => item.sourceCommercialCaseId === commercialCase.id)) {
    throw new Error("CHANTIER_ALREADY_LAUNCHED");
  }

  const quotePresent = hasDocument(commercialCase, "QUOTE");
  const signedQuotePresent = commercialHasSignedQuote(commercialCase);
  const costingPresent = hasDocument(commercialCase, "COSTING");

  if (!quotePresent && !input.quoteMissingDeclared) throw new Error("CHANTIER_QUOTE_DECLARATION_REQUIRED");
  if (!signedQuotePresent && !input.signedQuoteMissingDeclared) {
    throw new Error("CHANTIER_SIGNED_QUOTE_DECLARATION_REQUIRED");
  }
  if (!costingPresent && !input.costingMissingDeclared) throw new Error("CHANTIER_COSTING_DECLARATION_REQUIRED");

  const timestamp = now.toISOString();
  const item: ChantierRecord = {
    id: commercialCase.id,
    sourceCommercialCaseId: commercialCase.id,
    sourceEntryId: commercialCase.sourceEntryId,
    number: null,
    reference: null,
    name: commercialCase.name,
    clientName: commercialCase.clientName,
    companyName: null,
    siteLabel: commercialCase.siteLabel,
    contactName: commercialCase.contactName,
    contactPhone: commercialCase.contactPhone,
    contactEmail: commercialCase.contactEmail,
    description: commercialCase.description,
    nextAction: commercialCase.nextAction,
    status: "ACTIVE",
    plannedInstallDate: commercialCase.plannedInstallDate,
    launchYear: now.getFullYear(),
    launchDocuments: {
      quote: quotePresent ? "PRESENT" : "MISSING_DECLARED",
      signedQuote: signedQuotePresent ? "PRESENT" : "MISSING_DECLARED",
      costing: costingPresent ? "PRESENT" : "MISSING_DECLARED",
    },
    signedQuoteReminder: quotePresent && !signedQuotePresent,
    plannedHours: { be: input.be, workshop: input.workshop, install: input.install },
    actualHours: { be: 0, workshop: 0, install: 0 },
    launchedAt: timestamp,
    launchedByName: actor.displayName,
    completedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
    history: [],
  };

  const absent = [
    !quotePresent ? "devis client" : null,
    !signedQuotePresent ? "devis signé" : null,
    !costingPresent ? "déboursé OBAT" : null,
  ].filter(Boolean);
  history(
    item,
    actor.displayName,
    "LAUNCHED",
    `Chantier lancé depuis l'affaire commerciale. Charge initiale : BE ${input.be} h · Atelier ${input.workshop} h · Pose ${input.install} h${absent.length ? ` · Éléments déclarés absents : ${absent.join(", ")}` : ""}.`,
    now,
  );

  payload.chantiers.unshift(item);
  return { payload, focusChantierId: item.id };
}

export function applyChantierMutation(
  rawSource: ChantiersPayload,
  input: ChantierMutation,
  actor: ChantierActor,
  now: Date = new Date(),
): ChantierMutationResult {
  const payload = structuredClone(parseChantiersPayload(rawSource));
  const item = findChantier(payload, input.chantierId);

  if (input.action === "updateDetails") {
    if (item.status === "ARCHIVED") throw new Error("CHANTIER_ARCHIVED_READ_ONLY");
    item.number = text(input.number);
    item.reference = text(input.reference);
    item.name = input.name;
    item.clientName = text(input.clientName);
    item.companyName = text(input.companyName);
    item.siteLabel = text(input.siteLabel);
    item.contactName = text(input.contactName);
    item.contactPhone = text(input.contactPhone);
    item.contactEmail = text(input.contactEmail);
    item.description = text(input.description);
    item.nextAction = text(input.nextAction);
    touch(item, actor, now);
    history(item, actor.displayName, "DETAILS_UPDATED", "Informations du chantier mises à jour.", now);
    return { payload, focusChantierId: item.id };
  }

  if (input.action === "updatePlannedHours") {
    if (item.status === "ARCHIVED") throw new Error("CHANTIER_ARCHIVED_READ_ONLY");
    const previous = item.plannedHours;
    const next = { be: input.be, workshop: input.workshop, install: input.install };
    if (previous.be === next.be && previous.workshop === next.workshop && previous.install === next.install) {
      throw new Error("CHANTIER_HOURS_UNCHANGED");
    }
    item.plannedHours = next;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "PLANNED_HOURS_UPDATED",
      `Prévision modifiée : BE ${previous.be} → ${next.be} h · Atelier ${previous.workshop} → ${next.workshop} h · Pose ${previous.install} → ${next.install} h. Motif : ${input.reason}`,
      now,
    );
    return { payload, focusChantierId: item.id };
  }

  if (input.action === "markDone") {
    if (item.status !== "ACTIVE") throw new Error("CHANTIER_NOT_ACTIVE");
    item.status = "DONE";
    item.completedAt = now.toISOString();
    touch(item, actor, now);
    history(item, actor.displayName, "MARKED_DONE", "Chantier passé à Terminé.", now);
    return { payload, focusChantierId: item.id };
  }

  if (input.action === "reactivate") {
    if (item.status !== "DONE") throw new Error("CHANTIER_NOT_DONE");
    item.status = "ACTIVE";
    item.completedAt = null;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "REACTIVATED",
      `Chantier remis en Actif${input.reason.trim() ? ` · ${input.reason.trim()}` : ""}.`,
      now,
    );
    return { payload, focusChantierId: item.id };
  }

  if (input.action === "archive") {
    if (item.status !== "DONE") throw new Error("CHANTIER_NOT_DONE");
    item.status = "ARCHIVED";
    item.archivedAt = now.toISOString();
    touch(item, actor, now);
    history(item, actor.displayName, "ARCHIVED", "Chantier archivé après revue des éléments encore ouverts.", now);
    return { payload, focusChantierId: item.id };
  }

  if (input.action === "unarchive") {
    if (item.status !== "ARCHIVED") throw new Error("CHANTIER_NOT_ARCHIVED");
    item.status = "ACTIVE";
    item.archivedAt = null;
    item.completedAt = null;
    touch(item, actor, now);
    history(item, actor.displayName, "UNARCHIVED", `Chantier réactivé depuis les archives. Motif : ${input.reason}`, now);
    return { payload, focusChantierId: item.id };
  }

  throw new Error(`CHANTIER_MUTATION_UNSUPPORTED_${CHANTIER_STATUS_LABELS[item.status]}`);
}
