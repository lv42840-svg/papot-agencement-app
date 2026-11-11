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
    action: z.literal("linkSourceEntry"),
    caseId: z.string().uuid(),
    sourceEntryId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("retainAdditionalQuote"),
    caseId: z.string().uuid(),
    quoteId: z.string().uuid(),
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
    action: z.literal("setForecastQuotes"),
    caseId: z.string().uuid(),
    quoteIds: z.array(z.string().uuid()).max(1000),
  }),
  z.object({
    action: z.literal("useManualProvision"),
    caseId: z.string().uuid(),
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

function text(valeur: string): string | null {
  const trimmed = valeur.trim();
  return trimmed ? trimmed : null;
}

function findCase(contenu: CommercialPayload, idAffaire: string): CommercialCase {
  const element = contenu.cases.find((candidat) => candidat.id === idAffaire);
  if (!element) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
  return element;
}

export function assertCommercialRevision(element: CommercialCase, expectedUpdatedAt: string): void {
  if (element.updatedAt !== expectedUpdatedAt) {
    throw new Error("COMMERCIAL_VERSION_CONFLICT");
  }
}

function history(
  element: CommercialCase,
  actorName: string,
  type: CommercialCase["history"][number]["type"],
  summary: string,
  maintenant: Date,
): void {
  element.history.push({
    id: randomUUID(),
    type,
    at: maintenant.toISOString(),
    actorName,
    summary,
  });
}

function touch(element: CommercialCase, auteur: CommercialActor, maintenant: Date): void {
  element.updatedAt = maintenant.toISOString();
  element.updatedByName = auteur.displayName;
}

function assertOpen(element: CommercialCase): void {
  if (isCommercialClosed(element)) throw new Error("COMMERCIAL_CASE_CLOSED");
}

function setActiveStatus(
  element: CommercialCase,
  statut: Exclude<CommercialStatus, "LOST" | "ABANDONED">,
  parametres: {
    reviewDate?: string;
    expectedConfirmationDate?: string;
    quoteDueDate?: string;
    quoteOwnerName?: string;
    plannedInstallDate?: string;
    retainedQuoteIds?: string[];
  },
  auteur: CommercialActor,
  maintenant: Date,
): void {
  if ((statut === "PISTE" || statut === "SENT" || statut === "WAITING") && !parametres.reviewDate) {
    throw new Error("COMMERCIAL_REVIEW_DATE_REQUIRED");
  }
  if (statut === "LIKELY" && !parametres.expectedConfirmationDate) {
    throw new Error("COMMERCIAL_CONFIRMATION_DATE_REQUIRED");
  }
  if (statut === "CHIFFRAGE" && (!parametres.quoteDueDate || !parametres.quoteOwnerName?.trim())) {
    throw new Error("COMMERCIAL_QUOTE_OWNER_AND_DATE_REQUIRED");
  }
  if (statut === "CONFIRMED" && !parametres.plannedInstallDate) {
    throw new Error("COMMERCIAL_INSTALL_DATE_REQUIRED");
  }
  const precedent = element.status;
  element.status = statut;
  element.closedAt = null;
  element.closingReason = null;

  if (statut === "PISTE" || statut === "SENT" || statut === "WAITING") {
    element.reviewDate = parametres.reviewDate ?? null;
    element.expectedConfirmationDate = null;
  } else if (statut === "LIKELY") {
    element.reviewDate = null;
    element.expectedConfirmationDate = parametres.expectedConfirmationDate ?? null;
  } else if (statut === "CHIFFRAGE") {
    element.quoteDueDate = parametres.quoteDueDate ?? null;
    element.quoteOwnerName = parametres.quoteOwnerName?.trim() || null;
    element.reviewDate = null;
    element.expectedConfirmationDate = null;
  } else if (statut === "CONFIRMED") {
    element.plannedInstallDate = parametres.plannedInstallDate ?? null;
    element.confirmedAt = maintenant.toISOString();
    element.retainedQuoteIds = [...new Set(parametres.retainedQuoteIds ?? [])];
    element.reviewDate = null;
    element.expectedConfirmationDate = null;
    history(
      element,
      auteur.displayName,
      "QUOTES_RETAINED",
      element.retainedQuoteIds.length > 0
        ? `${element.retainedQuoteIds.length} devis retenu${element.retainedQuoteIds.length > 1 ? "s" : ""} pour la base contractuelle.`
        : "Affaire confirmée sans devis retenu.",
      maintenant,
    );
  } else if (statut === "FOLLOW_UP") {
    element.reviewDate = null;
    element.expectedConfirmationDate = null;
  }

  touch(element, auteur, maintenant);
  if (precedent !== statut) {
    history(
      element,
      auteur.displayName,
      "STATUS_CHANGED",
      `Statut : ${COMMERCIAL_STATUS_LABELS[precedent]} → ${COMMERCIAL_STATUS_LABELS[statut]}.`,
      maintenant,
    );
  }
}

export function registerCommercialDocuments(
  source: CommercialPayload,
  idAffaire: string,
  documents: CommercialDocument[],
  auteur: CommercialActor,
  maintenant: Date = new Date(),
): CommercialMutationResult {
  const contenu = structuredClone(source);
  const element = findCase(contenu, idAffaire);
  const identifiants = new Set(element.documents.map((document) => document.id));
  if (documents.some((document) => identifiants.has(document.id)))
    throw new Error("COMMERCIAL_DOCUMENT_DUPLICATE");

  for (const document of documents) {
    if (document.isCurrent) {
      for (const existing of element.documents) {
        if (existing.category === document.category) existing.isCurrent = false;
      }
    }
    element.documents.push(document);
  }

  if (documents.length > 0) {
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "DOCUMENTS_ADDED",
      `${documents.length} document${documents.length > 1 ? "s" : ""} ajouté${documents.length > 1 ? "s" : ""}.`,
      maintenant,
    );
  }
  return { payload: contenu, focusCaseId: element.id };
}

export function applyCommercialMutation(
  rawSource: CommercialPayload,
  saisie: CommercialMutation,
  auteur: CommercialActor,
  maintenant: Date = new Date(),
): CommercialMutationResult {
  const transitioned = applyCommercialAutomaticTransitions(
    parseCommercialPayload(rawSource),
    maintenant,
  ).payload;
  const contenu = structuredClone(transitioned);

  if (saisie.action === "create") {
    if (
      saisie.sourceEntryId &&
      contenu.cases.some((element) => element.sourceEntryId === saisie.sourceEntryId)
    ) {
      throw new Error("COMMERCIAL_SOURCE_TASK_ALREADY_LINKED");
    }

    const timestamp = maintenant.toISOString();
    const element: CommercialCase = {
      id: randomUUID(),
      sourceEntryId: saisie.sourceEntryId ?? null,
      name: saisie.name,
      clientName: text(saisie.clientName),
      siteLabel: text(saisie.siteLabel),
      siteAddressOverride: saisie.siteAddressOverride ?? null,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      description: text(saisie.description),
      nextAction: text(saisie.nextAction),
      status: "PISTE",
      quoteOwnerName: null,
      quoteDueDate: null,
      reviewDate: saisie.reviewDate,
      expectedConfirmationDate: null,
      plannedInstallDate: null,
      quoteSentAt: null,
      confirmedAt: null,
      retainedQuoteIds: [],
      forecastQuoteIds: null,
      closedAt: null,
      closingReason: null,
      quoteNotes: "",
      provisionHours: { be: 0, workshop: 0, install: 0 },
      documents: [],
      createdAt: timestamp,
      createdByName: auteur.displayName,
      updatedAt: timestamp,
      updatedByName: auteur.displayName,
      history: [],
    };
    history(
      element,
      auteur.displayName,
      "CREATED",
      saisie.sourceEntryId
        ? `Affaire créée depuis une tâche PAPOT en Piste, prochaine revue le ${saisie.reviewDate}.`
        : `Affaire créée en Piste, prochaine revue le ${saisie.reviewDate}.`,
      maintenant,
    );
    contenu.cases.unshift(element);
    return { payload: contenu, focusCaseId: element.id };
  }

  const element = findCase(contenu, saisie.caseId);

  if (saisie.action === "updateDetails") {
    assertOpen(element);
    element.name = saisie.name;
    element.clientName = text(saisie.clientName);
    element.siteLabel = text(saisie.siteLabel);
    if (saisie.siteAddressOverride !== undefined) {
      element.siteAddressOverride = saisie.siteAddressOverride;
    }
    element.contactName = text(saisie.contactName);
    element.contactPhone = text(saisie.contactPhone);
    element.contactEmail = text(saisie.contactEmail);
    element.description = text(saisie.description);
    element.nextAction = text(saisie.nextAction);
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "DETAILS_UPDATED",
      "Informations commerciales mises à jour.",
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "setStatus") {
    assertOpen(element);
    setActiveStatus(element, saisie.status, saisie, auteur, maintenant);
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "linkSourceEntry") {
    assertOpen(element);
    const alreadyLinked = contenu.cases.find(
      (candidat) => candidat.id !== element.id && candidat.sourceEntryId === saisie.sourceEntryId,
    );
    if (alreadyLinked) throw new Error("COMMERCIAL_SOURCE_TASK_ALREADY_LINKED");
    if (element.sourceEntryId && element.sourceEntryId !== saisie.sourceEntryId) {
      throw new Error("COMMERCIAL_CASE_SOURCE_ALREADY_LINKED");
    }
    element.sourceEntryId = saisie.sourceEntryId;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "SOURCE_ENTRY_LINKED",
      "Entrée PAPOT rattachée à l’affaire.",
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "retainAdditionalQuote") {
    if (element.status !== "CONFIRMED") throw new Error("COMMERCIAL_NOT_CONFIRMED");
    if (element.retainedQuoteIds.includes(saisie.quoteId)) {
      throw new Error("COMMERCIAL_QUOTE_ALREADY_RETAINED");
    }
    element.retainedQuoteIds.push(saisie.quoteId);
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "QUOTES_RETAINED",
      `Devis complémentaire accepté et ajouté à la base contractuelle (${element.retainedQuoteIds.length} devis retenus).`,
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "markQuoteSent") {
    assertOpen(element);
    const precedent = element.status;
    element.status = "SENT";
    element.quoteSentAt = maintenant.toISOString();
    element.reviewDate = saisie.followUpDate;
    element.expectedConfirmationDate = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "QUOTE_SENT",
      `Devis marqué envoyé. Relance obligatoire prévue le ${saisie.followUpDate}.`,
      maintenant,
    );
    if (precedent !== "SENT") {
      history(
        element,
        auteur.displayName,
        "STATUS_CHANGED",
        `Statut : ${COMMERCIAL_STATUS_LABELS[precedent]} → Envoyé.`,
        maintenant,
      );
    }
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "recordFollowUp") {
    assertOpen(element);
    history(element, auteur.displayName, "FOLLOW_UP", `Relance : ${saisie.summary}`, maintenant);

    if (saisie.nextStatus === "LOST" || saisie.nextStatus === "ABANDONED") {
      const precedent = element.status;
      element.status = saisie.nextStatus;
      element.closedAt = maintenant.toISOString();
      element.closingReason = text(saisie.closingReason ?? "");
      element.provisionHours = { be: 0, workshop: 0, install: 0 };
      element.forecastQuoteIds = [];
      touch(element, auteur, maintenant);
      history(
        element,
        auteur.displayName,
        "CLOSED",
        `${COMMERCIAL_STATUS_LABELS[precedent]} → ${COMMERCIAL_STATUS_LABELS[saisie.nextStatus]}${element.closingReason ? ` · ${element.closingReason}` : ""}.`,
        maintenant,
      );
      return { payload: contenu, focusCaseId: element.id };
    }

    if (saisie.nextStatus === "LIKELY") {
      setActiveStatus(
        element,
        "LIKELY",
        { expectedConfirmationDate: saisie.nextDate },
        auteur,
        maintenant,
      );
    } else if (saisie.nextStatus === "CHIFFRAGE") {
      setActiveStatus(
        element,
        "CHIFFRAGE",
        { quoteDueDate: saisie.quoteDueDate, quoteOwnerName: saisie.quoteOwnerName },
        auteur,
        maintenant,
      );
    } else if (saisie.nextStatus === "CONFIRMED") {
      setActiveStatus(
        element,
        "CONFIRMED",
        {
          plannedInstallDate: saisie.plannedInstallDate,
          retainedQuoteIds: saisie.retainedQuoteIds,
        },
        auteur,
        maintenant,
      );
    } else if (saisie.nextStatus === "PISTE") {
      setActiveStatus(element, "PISTE", { reviewDate: saisie.nextDate }, auteur, maintenant);
    } else if (saisie.nextStatus === "SENT") {
      setActiveStatus(element, "SENT", { reviewDate: saisie.nextDate }, auteur, maintenant);
    } else if (saisie.nextStatus === "FOLLOW_UP") {
      setActiveStatus(element, "FOLLOW_UP", {}, auteur, maintenant);
    } else {
      setActiveStatus(element, "WAITING", { reviewDate: saisie.nextDate }, auteur, maintenant);
    }
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "postponeQuoteDue") {
    assertOpen(element);
    if (element.status !== "CHIFFRAGE" || !element.quoteDueDate)
      throw new Error("COMMERCIAL_NOT_IN_QUOTING");
    if (saisie.newDate <= element.quoteDueDate) throw new Error("COMMERCIAL_QUOTE_DATE_NOT_LATER");
    const oldDate = element.quoteDueDate;
    element.quoteDueDate = saisie.newDate;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "QUOTE_DUE_POSTPONED",
      `Date prévue du devis repoussée du ${oldDate} au ${saisie.newDate}. Motif : ${saisie.reason}`,
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "updateNotes") {
    assertOpen(element);
    element.quoteNotes = saisie.quoteNotes;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "NOTES_UPDATED",
      "Notes internes de chiffrage mises à jour.",
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "setForecastQuotes") {
    assertOpen(element);
    if (element.status === "CONFIRMED") throw new Error("COMMERCIAL_ALREADY_CONFIRMED");
    if (new Set(saisie.quoteIds).size !== saisie.quoteIds.length) {
      throw new Error("COMMERCIAL_FORECAST_QUOTE_DUPLICATE");
    }
    element.forecastQuoteIds = [...saisie.quoteIds];
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "FORECAST_QUOTES_UPDATED",
      `${saisie.quoteIds.length} devis coché(s) pour les heures prévisionnelles.`,
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "useManualProvision") {
    assertOpen(element);
    if (element.status === "CONFIRMED") throw new Error("COMMERCIAL_ALREADY_CONFIRMED");
    element.forecastQuoteIds = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "FORECAST_QUOTES_UPDATED",
      "Retour à la charge manuelle.",
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "updateProvision") {
    assertOpen(element);
    element.provisionHours = { be: saisie.be, workshop: saisie.workshop, install: saisie.install };
    element.forecastQuoteIds = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "PROVISION_UPDATED",
      `Charge potentielle : BE ${saisie.be} h · Atelier ${saisie.workshop} h · Pose ${saisie.install} h.`,
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "close") {
    assertOpen(element);
    const precedent = element.status;
    element.status = saisie.status;
    element.closedAt = maintenant.toISOString();
    element.closingReason = text(saisie.reason);
    element.provisionHours = { be: 0, workshop: 0, install: 0 };
    element.reviewDate = null;
    element.expectedConfirmationDate = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "CLOSED",
      `${COMMERCIAL_STATUS_LABELS[precedent]} → ${COMMERCIAL_STATUS_LABELS[saisie.status]}${element.closingReason ? ` · ${element.closingReason}` : ""}.`,
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  if (saisie.action === "reopen") {
    if (!isCommercialClosed(element)) throw new Error("COMMERCIAL_CASE_NOT_CLOSED");
    const precedent = element.status;
    element.status = "PISTE";
    element.reviewDate = saisie.reviewDate;
    element.closedAt = null;
    element.closingReason = null;
    element.confirmedAt = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "REOPENED",
      `${COMMERCIAL_STATUS_LABELS[precedent]} rouvert en Piste. Prochaine revue le ${saisie.reviewDate}. La charge potentielle n'est pas restaurée automatiquement.`,
      maintenant,
    );
    return { payload: contenu, focusCaseId: element.id };
  }

  throw new Error("COMMERCIAL_MUTATION_UNSUPPORTED");
}

export function listCommercialPeople(
  contenu: CommercialPayload,
  auteur: CommercialActor,
): string[] {
  const noms = new Set<string>(["Nadia", "Lucien", auteur.displayName]);
  for (const element of contenu.cases) {
    if (element.quoteOwnerName) noms.add(element.quoteOwnerName);
    noms.add(element.createdByName);
    noms.add(element.updatedByName);
  }
  return [...noms].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr-FR"));
}
