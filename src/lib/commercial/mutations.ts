import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  COMMERCIAL_STATUS_LABELS,
  applyCommercialAutomaticTransitions,
  commercialSiteAddressSchema,
  commercialStatusSchema,
  isCommercialClosed,
  parseCommercialPayload,
  type CommercialCase,
  type CommercialDocument,
  type CommercialPayload,
  type CommercialStatus,
} from "./domain";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableText = (max: number) => z.string().trim().max(max).optional().default("");

export const commercialMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(240),
    clientName: nullableText(240),
    siteLabel: nullableText(240),
    siteAddressOverride: commercialSiteAddressSchema.nullable().optional(),
    reviewDate: dateOnlySchema,
    sourceEntryId: z.string().uuid().optional(),
    description: nullableText(4000),
    nextAction: nullableText(2000),
  }),
  z.object({
    action: z.literal("updateDetails"),
    caseId: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
    clientName: nullableText(240),
    siteLabel: nullableText(240),
    siteAddressOverride: commercialSiteAddressSchema.nullable().optional(),
    contactName: nullableText(160),
    contactPhone: nullableText(80),
    contactEmail: nullableText(240),
    description: nullableText(4000),
    nextAction: nullableText(2000),
  }),
  z.object({
    action: z.literal("setStatus"),
    caseId: z.string().uuid(),
    status: commercialStatusSchema.exclude(["LOST", "ABANDONED"]),
    reviewDate: dateOnlySchema.optional(),
    expectedConfirmationDate: dateOnlySchema.optional(),
    quoteDueDate: dateOnlySchema.optional(),
    quoteOwnerName: z.string().trim().max(120).optional(),
    plannedInstallDate: dateOnlySchema.optional(),
    retainedQuoteIds: z.array(z.string().uuid()).max(1000).optional(),
    confirmWithoutQuote: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("markQuoteSent"),
    caseId: z.string().uuid(),
    followUpDate: dateOnlySchema,
  }),
  z.object({
    action: z.literal("recordFollowUp"),
    caseId: z.string().uuid(),
    summary: z.string().trim().min(1).max(3000),
    nextStatus: commercialStatusSchema,
    nextDate: dateOnlySchema.optional(),
    quoteDueDate: dateOnlySchema.optional(),
    quoteOwnerName: z.string().trim().max(120).optional(),
    plannedInstallDate: dateOnlySchema.optional(),
    retainedQuoteIds: z.array(z.string().uuid()).max(1000).optional(),
    confirmWithoutQuote: z.boolean().optional(),
    closingReason: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("postponeQuoteDue"),
    caseId: z.string().uuid(),
    newDate: dateOnlySchema,
    reason: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("updateNotes"),
    caseId: z.string().uuid(),
    quoteNotes: z.string().max(12000),
  }),
  z.object({
    action: z.literal("updateProvision"),
    caseId: z.string().uuid(),
    be: z.number().min(0).max(100000),
    workshop: z.number().min(0).max(100000),
    install: z.number().min(0).max(100000),
  }),
  z.object({
    action: z.literal("close"),
    caseId: z.string().uuid(),
    status: z.enum(["LOST", "ABANDONED"]),
    reason: z.string().trim().max(2000).optional().default(""),
  }),
  z.object({
    action: z.literal("reopen"),
    caseId: z.string().uuid(),
    reviewDate: dateOnlySchema,
  }),
]);

export type CommercialMutation = z.infer<typeof commercialMutationSchema>;
export type CommercialActor = { userId: string; displayName: string };
export type CommercialMutationResult = { payload: CommercialPayload; focusCaseId?: string };

export type CommercialCapabilities = {
  canCreate: boolean;
  canRead: boolean;
  canModify: boolean;
  canProvision: boolean;
  canConfirm: boolean;
};

export function commercialCapabilities(_actor: CommercialActor): CommercialCapabilities {
  // The capability split is already explicit in the API shape so the future
  // per-user settings module can bind these flags without changing Commercial.
  return { canCreate: true, canRead: true, canModify: true, canProvision: true, canConfirm: true };
}

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function findCase(payload: CommercialPayload, caseId: string): CommercialCase {
  const item = payload.cases.find((candidate) => candidate.id === caseId);
  if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
  return item;
}

function history(
  item: CommercialCase,
  actorName: string,
  type: CommercialCase["history"][number]["type"],
  summary: string,
  now: Date,
): void {
  item.history.push({ id: randomUUID(), type, at: now.toISOString(), actorName, summary });
}

function touch(item: CommercialCase, actor: CommercialActor, now: Date): void {
  item.updatedAt = now.toISOString();
  item.updatedByName = actor.displayName;
}

function assertOpen(item: CommercialCase): void {
  if (isCommercialClosed(item)) throw new Error("COMMERCIAL_CASE_CLOSED");
}

function setActiveStatus(
  item: CommercialCase,
  status: Exclude<CommercialStatus, "LOST" | "ABANDONED">,
  params: {
    reviewDate?: string;
    expectedConfirmationDate?: string;
    quoteDueDate?: string;
    quoteOwnerName?: string;
    plannedInstallDate?: string;
    retainedQuoteIds?: string[];
  },
  actor: CommercialActor,
  now: Date,
): void {
  if ((status === "PISTE" || status === "SENT" || status === "WAITING") && !params.reviewDate) {
    throw new Error("COMMERCIAL_REVIEW_DATE_REQUIRED");
  }
  if (status === "LIKELY" && !params.expectedConfirmationDate) {
    throw new Error("COMMERCIAL_CONFIRMATION_DATE_REQUIRED");
  }
  if (status === "CHIFFRAGE" && (!params.quoteDueDate || !params.quoteOwnerName?.trim())) {
    throw new Error("COMMERCIAL_QUOTE_OWNER_AND_DATE_REQUIRED");
  }
  if (status === "CONFIRMED" && !params.plannedInstallDate) {
    throw new Error("COMMERCIAL_INSTALL_DATE_REQUIRED");
  }
  if (status === "CONFIRMED" && params.retainedQuoteIds === undefined) {
    throw new Error("COMMERCIAL_QUOTE_SELECTION_REQUIRED");
  }

  const previous = item.status;
  item.status = status;
  item.closedAt = null;
  item.closingReason = null;

  if (status === "PISTE" || status === "SENT" || status === "WAITING") {
    item.reviewDate = params.reviewDate ?? null;
    item.expectedConfirmationDate = null;
  } else if (status === "LIKELY") {
    item.reviewDate = null;
    item.expectedConfirmationDate = params.expectedConfirmationDate ?? null;
  } else if (status === "CHIFFRAGE") {
    item.quoteDueDate = params.quoteDueDate ?? null;
    item.quoteOwnerName = params.quoteOwnerName?.trim() || null;
    item.reviewDate = null;
    item.expectedConfirmationDate = null;
  } else if (status === "CONFIRMED") {
    item.plannedInstallDate = params.plannedInstallDate ?? null;
    item.confirmedAt = now.toISOString();
    item.retainedQuoteIds = [...new Set(params.retainedQuoteIds ?? [])];
    item.reviewDate = null;
    item.expectedConfirmationDate = null;
    history(
      item,
      actor.displayName,
      "QUOTES_RETAINED",
      item.retainedQuoteIds.length > 0
        ? `${item.retainedQuoteIds.length} devis retenu${item.retainedQuoteIds.length > 1 ? "s" : ""} pour la base contractuelle.`
        : "Affaire confirmée sans devis retenu.",
      now,
    );
  } else if (status === "FOLLOW_UP") {
    item.reviewDate = null;
    item.expectedConfirmationDate = null;
  }

  touch(item, actor, now);
  if (previous !== status) {
    history(
      item,
      actor.displayName,
      "STATUS_CHANGED",
      `Statut : ${COMMERCIAL_STATUS_LABELS[previous]} → ${COMMERCIAL_STATUS_LABELS[status]}.`,
      now,
    );
  }
}

export function registerCommercialDocuments(
  source: CommercialPayload,
  caseId: string,
  documents: CommercialDocument[],
  actor: CommercialActor,
  now: Date = new Date(),
): CommercialMutationResult {
  const payload = structuredClone(source);
  const item = findCase(payload, caseId);
  const ids = new Set(item.documents.map((document) => document.id));
  if (documents.some((document) => ids.has(document.id)))
    throw new Error("COMMERCIAL_DOCUMENT_DUPLICATE");

  for (const document of documents) {
    if (document.isCurrent) {
      for (const existing of item.documents) {
        if (existing.category === document.category) existing.isCurrent = false;
      }
    }
    item.documents.push(document);
  }

  if (documents.length > 0) {
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "DOCUMENTS_ADDED",
      `${documents.length} document${documents.length > 1 ? "s" : ""} ajouté${documents.length > 1 ? "s" : ""}.`,
      now,
    );
  }
  return { payload, focusCaseId: item.id };
}

export function applyCommercialMutation(
  rawSource: CommercialPayload,
  input: CommercialMutation,
  actor: CommercialActor,
  now: Date = new Date(),
): CommercialMutationResult {
  const transitioned = applyCommercialAutomaticTransitions(
    parseCommercialPayload(rawSource),
    now,
  ).payload;
  const payload = structuredClone(transitioned);

  if (input.action === "create") {
    if (
      input.sourceEntryId &&
      payload.cases.some((item) => item.sourceEntryId === input.sourceEntryId)
    ) {
      throw new Error("COMMERCIAL_SOURCE_TASK_ALREADY_LINKED");
    }

    const timestamp = now.toISOString();
    const item: CommercialCase = {
      id: randomUUID(),
      sourceEntryId: input.sourceEntryId ?? null,
      name: input.name,
      clientName: text(input.clientName),
      siteLabel: text(input.siteLabel),
      siteAddressOverride: input.siteAddressOverride ?? null,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      description: text(input.description),
      nextAction: text(input.nextAction),
      status: "PISTE",
      quoteOwnerName: null,
      quoteDueDate: null,
      reviewDate: input.reviewDate,
      expectedConfirmationDate: null,
      plannedInstallDate: null,
      quoteSentAt: null,
      confirmedAt: null,
      retainedQuoteIds: [],
      closedAt: null,
      closingReason: null,
      quoteNotes: "",
      provisionHours: { be: 0, workshop: 0, install: 0 },
      documents: [],
      createdAt: timestamp,
      createdByName: actor.displayName,
      updatedAt: timestamp,
      updatedByName: actor.displayName,
      history: [],
    };
    history(
      item,
      actor.displayName,
      "CREATED",
      input.sourceEntryId
        ? `Affaire créée depuis une tâche PAPOT en Piste, prochaine revue le ${input.reviewDate}.`
        : `Affaire créée en Piste, prochaine revue le ${input.reviewDate}.`,
      now,
    );
    payload.cases.unshift(item);
    return { payload, focusCaseId: item.id };
  }

  const item = findCase(payload, input.caseId);

  if (input.action === "updateDetails") {
    assertOpen(item);
    item.name = input.name;
    item.clientName = text(input.clientName);
    item.siteLabel = text(input.siteLabel);
    if (input.siteAddressOverride !== undefined) {
      item.siteAddressOverride = input.siteAddressOverride;
    }
    item.contactName = text(input.contactName);
    item.contactPhone = text(input.contactPhone);
    item.contactEmail = text(input.contactEmail);
    item.description = text(input.description);
    item.nextAction = text(input.nextAction);
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "DETAILS_UPDATED",
      "Informations commerciales mises à jour.",
      now,
    );
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "setStatus") {
    assertOpen(item);
    setActiveStatus(item, input.status, input, actor, now);
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "markQuoteSent") {
    assertOpen(item);
    const previous = item.status;
    item.status = "SENT";
    item.quoteSentAt = now.toISOString();
    item.reviewDate = input.followUpDate;
    item.expectedConfirmationDate = null;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "QUOTE_SENT",
      `Devis marqué envoyé. Relance obligatoire prévue le ${input.followUpDate}.`,
      now,
    );
    if (previous !== "SENT") {
      history(
        item,
        actor.displayName,
        "STATUS_CHANGED",
        `Statut : ${COMMERCIAL_STATUS_LABELS[previous]} → Envoyé.`,
        now,
      );
    }
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "recordFollowUp") {
    assertOpen(item);
    history(item, actor.displayName, "FOLLOW_UP", `Relance : ${input.summary}`, now);

    if (input.nextStatus === "LOST" || input.nextStatus === "ABANDONED") {
      const previous = item.status;
      item.status = input.nextStatus;
      item.closedAt = now.toISOString();
      item.closingReason = text(input.closingReason ?? "");
      item.provisionHours = { be: 0, workshop: 0, install: 0 };
      touch(item, actor, now);
      history(
        item,
        actor.displayName,
        "CLOSED",
        `${COMMERCIAL_STATUS_LABELS[previous]} → ${COMMERCIAL_STATUS_LABELS[input.nextStatus]}${item.closingReason ? ` · ${item.closingReason}` : ""}.`,
        now,
      );
      return { payload, focusCaseId: item.id };
    }

    if (input.nextStatus === "LIKELY") {
      setActiveStatus(item, "LIKELY", { expectedConfirmationDate: input.nextDate }, actor, now);
    } else if (input.nextStatus === "CHIFFRAGE") {
      setActiveStatus(
        item,
        "CHIFFRAGE",
        { quoteDueDate: input.quoteDueDate, quoteOwnerName: input.quoteOwnerName },
        actor,
        now,
      );
    } else if (input.nextStatus === "CONFIRMED") {
      setActiveStatus(
        item,
        "CONFIRMED",
        {
          plannedInstallDate: input.plannedInstallDate,
          retainedQuoteIds: input.retainedQuoteIds,
        },
        actor,
        now,
      );
    } else if (input.nextStatus === "PISTE") {
      setActiveStatus(item, "PISTE", { reviewDate: input.nextDate }, actor, now);
    } else if (input.nextStatus === "SENT") {
      setActiveStatus(item, "SENT", { reviewDate: input.nextDate }, actor, now);
    } else if (input.nextStatus === "FOLLOW_UP") {
      setActiveStatus(item, "FOLLOW_UP", {}, actor, now);
    } else {
      setActiveStatus(item, "WAITING", { reviewDate: input.nextDate }, actor, now);
    }
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "postponeQuoteDue") {
    assertOpen(item);
    if (item.status !== "CHIFFRAGE" || !item.quoteDueDate)
      throw new Error("COMMERCIAL_NOT_IN_QUOTING");
    if (input.newDate <= item.quoteDueDate) throw new Error("COMMERCIAL_QUOTE_DATE_NOT_LATER");
    const oldDate = item.quoteDueDate;
    item.quoteDueDate = input.newDate;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "QUOTE_DUE_POSTPONED",
      `Date prévue du devis repoussée du ${oldDate} au ${input.newDate}. Motif : ${input.reason}`,
      now,
    );
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "updateNotes") {
    assertOpen(item);
    item.quoteNotes = input.quoteNotes;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "NOTES_UPDATED",
      "Notes internes de chiffrage mises à jour.",
      now,
    );
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "updateProvision") {
    assertOpen(item);
    item.provisionHours = { be: input.be, workshop: input.workshop, install: input.install };
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "PROVISION_UPDATED",
      `Charge potentielle : BE ${input.be} h · Atelier ${input.workshop} h · Pose ${input.install} h.`,
      now,
    );
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "close") {
    assertOpen(item);
    const previous = item.status;
    item.status = input.status;
    item.closedAt = now.toISOString();
    item.closingReason = text(input.reason);
    item.provisionHours = { be: 0, workshop: 0, install: 0 };
    item.reviewDate = null;
    item.expectedConfirmationDate = null;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "CLOSED",
      `${COMMERCIAL_STATUS_LABELS[previous]} → ${COMMERCIAL_STATUS_LABELS[input.status]}${item.closingReason ? ` · ${item.closingReason}` : ""}.`,
      now,
    );
    return { payload, focusCaseId: item.id };
  }

  if (input.action === "reopen") {
    if (!isCommercialClosed(item)) throw new Error("COMMERCIAL_CASE_NOT_CLOSED");
    const previous = item.status;
    item.status = "PISTE";
    item.reviewDate = input.reviewDate;
    item.closedAt = null;
    item.closingReason = null;
    item.confirmedAt = null;
    touch(item, actor, now);
    history(
      item,
      actor.displayName,
      "REOPENED",
      `${COMMERCIAL_STATUS_LABELS[previous]} rouvert en Piste. Prochaine revue le ${input.reviewDate}. La charge potentielle n'est pas restaurée automatiquement.`,
      now,
    );
    return { payload, focusCaseId: item.id };
  }

  throw new Error("COMMERCIAL_MUTATION_UNSUPPORTED");
}

export function listCommercialPeople(payload: CommercialPayload, actor: CommercialActor): string[] {
  const names = new Set<string>(["Nadia", "Lucien", actor.displayName]);
  for (const item of payload.cases) {
    if (item.quoteOwnerName) names.add(item.quoteOwnerName);
    names.add(item.createdByName);
    names.add(item.updatedByName);
  }
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr-FR"));
}
