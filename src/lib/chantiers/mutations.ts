import { randomUUID } from "node:crypto";
import { z } from "zod";
import { commercialHasSignedQuote, type CommercialCase } from "../commercial/domain";
import {
  BE_STATUS_LABELS,
  CHANTIER_STATUS_LABELS,
  INSTALL_STATUS_LABELS,
  WORKSHOP_STATUS_LABELS,
  parseChantiersPayload,
  type BeItem,
  type ChantierRecord,
  type ChantiersPayload,
  type InstallItem,
  type WorkshopItem,
} from "./domain";

const nullableText = (max: number) => z.string().trim().max(max).optional().default("");
const technicalOriginInput = z.object({
  name: z.string().trim().min(1).max(240),
  originKind: z.enum(["QUOTE_LINE", "TS"]),
  originLabel: nullableText(500),
  installedByUs: z.boolean(),
  sourceQuoteId: z.string().uuid().nullable().optional(),
  sourceQuoteLineId: z.string().uuid().nullable().optional(),
});

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
  technicalOriginInput.extend({
    action: z.literal("createBeItem"),
    chantierId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("setBeStatus"),
    chantierId: z.string().uuid(),
    beItemId: z.string().uuid(),
    status: z.enum(["TODO", "DRAW", "VALIDATION", "VALIDATED"]),
  }),
  technicalOriginInput.extend({
    action: z.literal("createWorkshopItem"),
    chantierId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("setWorkshopStatus"),
    chantierId: z.string().uuid(),
    workshopItemId: z.string().uuid(),
    status: z.enum(["PREPARE", "READY", "IN_PROGRESS", "DONE"]),
  }),
  z.object({
    action: z.literal("setInstallStatus"),
    chantierId: z.string().uuid(),
    installItemId: z.string().uuid(),
    status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
    note: nullableText(2000),
  }),
  z.object({
    action: z.literal("setOperationalSpaceState"),
    chantierId: z.string().uuid(),
    spaceId: z.enum(["admin", "be", "workshop", "install", "meeting", "mail", "reception"]),
    state: z.enum(["APPLICABLE", "NOT_APPLICABLE"]),
  }),
  z.object({
    action: z.literal("setQuoteLineProgress"),
    chantierId: z.string().uuid(),
    quoteId: z.string().uuid(),
    quoteLineId: z.string().uuid(),
    status: z.enum(["TODO", "DONE"]),
    quoteLineLabel: nullableText(500),
  }),
  z.object({
    action: z.literal("markDone"),
    chantierId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
    purchaseReview: z
      .object({
        decision: z.enum(["KEEP", "REMOVE"]),
        token: z.string().min(1).max(10000),
        confirmRemove: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    chantierId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("reactivate"),
    chantierId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
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
  canCloseReopen: boolean;
  canArchive: boolean;
};

export function chantierCapabilities(_actor: ChantierActor): ChantierCapabilities {
  return {
    canRead: true,
    canModify: true,
    canLaunch: true,
    canCloseReopen: true,
    canArchive: true,
  };
}

function text(valeur: string): string | null {
  const trimmed = valeur.trim();
  return trimmed ? trimmed : null;
}

function findChantier(contenu: ChantiersPayload, chantierId: string): ChantierRecord {
  const element = contenu.chantiers.find((candidat) => candidat.id === chantierId);
  if (!element) throw new Error("CHANTIER_NOT_FOUND");
  return element;
}

export function assertChantierRevision(element: ChantierRecord, expectedUpdatedAt: string): void {
  if (element.updatedAt !== expectedUpdatedAt) {
    throw new Error("CHANTIERS_VERSION_CONFLICT");
  }
}

function history(
  element: ChantierRecord,
  actorName: string,
  type: ChantierRecord["history"][number]["type"],
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

function touch(element: ChantierRecord, auteur: ChantierActor, maintenant: Date): void {
  element.updatedAt = maintenant.toISOString();
  element.updatedByName = auteur.displayName;
}

function hasDocument(element: CommercialCase, category: "QUOTE" | "COSTING"): boolean {
  return element.documents.some((document) => document.category === category);
}

function ensureOperationalEditable(element: ChantierRecord): void {
  if (element.status === "ARCHIVED") throw new Error("CHANTIER_ARCHIVED_READ_ONLY");
}

function findBeItem(element: ChantierRecord, id: string): BeItem {
  const resultat = element.operational.beItems.find((candidat) => candidat.id === id);
  if (!resultat) throw new Error("CHANTIER_BE_ITEM_NOT_FOUND");
  return resultat;
}

function findWorkshopItem(element: ChantierRecord, id: string): WorkshopItem {
  const resultat = element.operational.workshopItems.find((candidat) => candidat.id === id);
  if (!resultat) throw new Error("CHANTIER_WORKSHOP_ITEM_NOT_FOUND");
  return resultat;
}

function findInstallItem(element: ChantierRecord, id: string): InstallItem {
  const resultat = element.operational.installItems.find((candidat) => candidat.id === id);
  if (!resultat) throw new Error("CHANTIER_INSTALL_ITEM_NOT_FOUND");
  return resultat;
}

function createWorkshopFromBe(
  element: ChantierRecord,
  beItem: BeItem,
  maintenant: Date,
): WorkshopItem {
  const existing = element.operational.workshopItems.find(
    (candidat) => candidat.sourceBeItemId === beItem.id,
  );
  if (existing) return existing;
  const timestamp = maintenant.toISOString();
  const created: WorkshopItem = {
    id: randomUUID(),
    sourceBeItemId: beItem.id,
    name: beItem.name,
    originKind: beItem.originKind,
    originLabel: beItem.originLabel,
    installedByUs: beItem.installedByUs,
    sourceQuoteId: beItem.sourceQuoteId,
    sourceQuoteLineId: beItem.sourceQuoteLineId,
    status: "PREPARE",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  element.operational.workshopItems.push(created);
  return created;
}

function createInstallFromTechnical(
  element: ChantierRecord,
  source: {
    sourceBeItemId: string | null;
    sourceWorkshopItemId: string | null;
    name: string;
    originKind: "QUOTE_LINE" | "TS";
    originLabel: string | null;
    sourceQuoteId: string | null;
    sourceQuoteLineId: string | null;
  },
  maintenant: Date,
): InstallItem {
  const existing = element.operational.installItems.find(
    (candidat) =>
      (source.sourceBeItemId && candidat.sourceBeItemId === source.sourceBeItemId) ||
      (source.sourceWorkshopItemId &&
        candidat.sourceWorkshopItemId === source.sourceWorkshopItemId),
  );
  if (existing) return existing;
  const timestamp = maintenant.toISOString();
  const created: InstallItem = {
    id: randomUUID(),
    sourceBeItemId: source.sourceBeItemId,
    sourceWorkshopItemId: source.sourceWorkshopItemId,
    name: source.name,
    originKind: source.originKind,
    originLabel: source.originLabel,
    sourceQuoteId: source.sourceQuoteId,
    sourceQuoteLineId: source.sourceQuoteLineId,
    status: "TODO",
    note: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  element.operational.installItems.push(created);
  return created;
}

export function launchChantierFromCommercial(
  rawSource: ChantiersPayload,
  commercialCase: CommercialCase,
  saisie: LaunchChantierInput,
  auteur: ChantierActor,
  maintenant: Date = new Date(),
): ChantierMutationResult {
  const source = parseChantiersPayload(rawSource);
  const contenu = structuredClone(source);

  if (commercialCase.id !== saisie.commercialCaseId)
    throw new Error("CHANTIER_COMMERCIAL_CASE_MISMATCH");
  if (commercialCase.status !== "CONFIRMED") throw new Error("CHANTIER_COMMERCIAL_NOT_CONFIRMED");
  if (!commercialCase.plannedInstallDate) throw new Error("CHANTIER_INSTALL_DATE_REQUIRED");
  if (contenu.chantiers.some((element) => element.sourceCommercialCaseId === commercialCase.id)) {
    throw new Error("CHANTIER_ALREADY_LAUNCHED");
  }

  const quotePresent =
    commercialCase.retainedQuoteIds.length > 0 || hasDocument(commercialCase, "QUOTE");
  const signedQuotePresent = commercialHasSignedQuote(commercialCase);
  const costingPresent = hasDocument(commercialCase, "COSTING");

  if (!quotePresent && !saisie.quoteMissingDeclared)
    throw new Error("CHANTIER_QUOTE_DECLARATION_REQUIRED");
  if (!signedQuotePresent && !saisie.signedQuoteMissingDeclared) {
    throw new Error("CHANTIER_SIGNED_QUOTE_DECLARATION_REQUIRED");
  }
  if (!costingPresent && !saisie.costingMissingDeclared)
    throw new Error("CHANTIER_COSTING_DECLARATION_REQUIRED");

  const timestamp = maintenant.toISOString();
  const element: ChantierRecord = {
    id: commercialCase.id,
    sourceCommercialCaseId: commercialCase.id,
    sourceEntryId: commercialCase.sourceEntryId,
    initialRetainedQuoteIds: [...commercialCase.retainedQuoteIds],
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
    launchYear: maintenant.getFullYear(),
    launchDocuments: {
      quote: quotePresent ? "PRESENT" : "MISSING_DECLARED",
      signedQuote: signedQuotePresent ? "PRESENT" : "MISSING_DECLARED",
      costing: costingPresent ? "PRESENT" : "MISSING_DECLARED",
    },
    signedQuoteReminder: quotePresent && !signedQuotePresent,
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
    history: [],
  };

  const absent = [
    !quotePresent ? "devis client" : null,
    !signedQuotePresent ? "devis signé" : null,
    !costingPresent ? "déboursé" : null,
  ].filter(Boolean);
  history(
    element,
    auteur.displayName,
    "LAUNCHED",
    `Chantier lancé depuis l'affaire commerciale. Charge initiale : BE ${saisie.be} h · Atelier ${saisie.workshop} h · Pose ${saisie.install} h${absent.length ? ` · Éléments déclarés absents : ${absent.join(", ")}` : ""}.`,
    maintenant,
  );

  contenu.chantiers.unshift(element);
  return { payload: contenu, focusChantierId: element.id };
}

export function applyChantierMutation(
  rawSource: ChantiersPayload,
  saisie: ChantierMutation,
  auteur: ChantierActor,
  maintenant: Date = new Date(),
): ChantierMutationResult {
  const contenu = structuredClone(parseChantiersPayload(rawSource));
  const element = findChantier(contenu, saisie.chantierId);

  // Cancellation preserves the dossier but stops operational changes until reopening.
  if (
    element.status === "CANCELLED" &&
    saisie.action !== "reactivate" &&
    saisie.action !== "archive"
  ) {
    throw new Error("CHANTIER_CANCELLED_READ_ONLY");
  }

  if (saisie.action === "updateDetails") {
    if (element.status === "ARCHIVED") throw new Error("CHANTIER_ARCHIVED_READ_ONLY");
    element.number = text(saisie.number);
    element.reference = text(saisie.reference);
    element.name = saisie.name;
    element.clientName = text(saisie.clientName);
    element.companyName = text(saisie.companyName);
    element.siteLabel = text(saisie.siteLabel);
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
      "Informations du chantier mises à jour.",
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "updatePlannedHours") {
    if (element.status === "ARCHIVED") throw new Error("CHANTIER_ARCHIVED_READ_ONLY");
    const precedent = element.plannedHours;
    const suivant = { be: saisie.be, workshop: saisie.workshop, install: saisie.install };
    if (
      precedent.be === suivant.be &&
      precedent.workshop === suivant.workshop &&
      precedent.install === suivant.install
    ) {
      throw new Error("CHANTIER_HOURS_UNCHANGED");
    }
    element.plannedHours = suivant;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "PLANNED_HOURS_UPDATED",
      `Prévision modifiée : BE ${precedent.be} → ${suivant.be} h · Atelier ${precedent.workshop} → ${suivant.workshop} h · Pose ${precedent.install} → ${suivant.install} h. Motif : ${saisie.reason}`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "createBeItem") {
    ensureOperationalEditable(element);
    const timestamp = maintenant.toISOString();
    const created: BeItem = {
      id: randomUUID(),
      name: saisie.name,
      originKind: saisie.originKind,
      originLabel: text(saisie.originLabel),
      installedByUs: saisie.installedByUs,
      sourceQuoteId: saisie.sourceQuoteId ?? null,
      sourceQuoteLineId: saisie.sourceQuoteLineId ?? null,
      status: "TODO",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    element.operational.beItems.push(created);
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_ITEM_CREATED",
      `BE : ${created.name} créé (${created.originKind === "TS" ? "TS" : "ligne devis"}${created.installedByUs ? " · posé par PAPOT" : ""}).`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "setBeStatus") {
    ensureOperationalEditable(element);
    const beItem = findBeItem(element, saisie.beItemId);
    const precedent = beItem.status;
    beItem.status = saisie.status;
    beItem.updatedAt = maintenant.toISOString();
    if (saisie.status === "VALIDATED") {
      const workshop = createWorkshopFromBe(element, beItem, maintenant);
      if (beItem.installedByUs) {
        createInstallFromTechnical(
          element,
          {
            sourceBeItemId: beItem.id,
            sourceWorkshopItemId: workshop.id,
            name: beItem.name,
            originKind: beItem.originKind,
            originLabel: beItem.originLabel,
            sourceQuoteId: beItem.sourceQuoteId,
            sourceQuoteLineId: beItem.sourceQuoteLineId,
          },
          maintenant,
        );
      }
    }
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_STATUS_UPDATED",
      `BE · ${beItem.name} : ${BE_STATUS_LABELS[precedent]} → ${BE_STATUS_LABELS[saisie.status]}.`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "createWorkshopItem") {
    ensureOperationalEditable(element);
    const timestamp = maintenant.toISOString();
    const created: WorkshopItem = {
      id: randomUUID(),
      sourceBeItemId: null,
      name: saisie.name,
      originKind: saisie.originKind,
      originLabel: text(saisie.originLabel),
      installedByUs: saisie.installedByUs,
      sourceQuoteId: saisie.sourceQuoteId ?? null,
      sourceQuoteLineId: saisie.sourceQuoteLineId ?? null,
      status: "PREPARE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    element.operational.workshopItems.push(created);
    if (created.installedByUs) {
      createInstallFromTechnical(
        element,
        {
          sourceBeItemId: null,
          sourceWorkshopItemId: created.id,
          name: created.name,
          originKind: created.originKind,
          originLabel: created.originLabel,
          sourceQuoteId: created.sourceQuoteId,
          sourceQuoteLineId: created.sourceQuoteLineId,
        },
        maintenant,
      );
    }
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_ITEM_CREATED",
      `Atelier : ${created.name} créé directement (${created.originKind === "TS" ? "TS" : "ligne devis"}${created.installedByUs ? " · posé par PAPOT" : ""}).`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "setWorkshopStatus") {
    ensureOperationalEditable(element);
    const workshopItem = findWorkshopItem(element, saisie.workshopItemId);
    const precedent = workshopItem.status;
    workshopItem.status = saisie.status;
    workshopItem.updatedAt = maintenant.toISOString();
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_STATUS_UPDATED",
      `Atelier · ${workshopItem.name} : ${WORKSHOP_STATUS_LABELS[precedent]} → ${WORKSHOP_STATUS_LABELS[saisie.status]}.`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "setInstallStatus") {
    ensureOperationalEditable(element);
    const installItem = findInstallItem(element, saisie.installItemId);
    const precedent = installItem.status;
    installItem.status = saisie.status;
    installItem.note = text(saisie.note);
    installItem.updatedAt = maintenant.toISOString();
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_STATUS_UPDATED",
      `Pose · ${installItem.name} : ${INSTALL_STATUS_LABELS[precedent]} → ${INSTALL_STATUS_LABELS[saisie.status]}${installItem.note ? ` · ${installItem.note}` : ""}.`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "setQuoteLineProgress") {
    ensureOperationalEditable(element);
    const precedent = element.operational.quoteLineProgress.find(
      (candidat) =>
        candidat.quoteId === saisie.quoteId && candidat.quoteLineId === saisie.quoteLineId,
    );
    const previousStatus = precedent?.status ?? "TODO";
    if (previousStatus === saisie.status) {
      throw new Error("CHANTIER_QUOTE_LINE_PROGRESS_UNCHANGED");
    }

    if (precedent) {
      precedent.status = saisie.status;
      precedent.updatedAt = maintenant.toISOString();
      precedent.updatedByName = auteur.displayName;
    } else {
      element.operational.quoteLineProgress.push({
        quoteId: saisie.quoteId,
        quoteLineId: saisie.quoteLineId,
        status: saisie.status,
        updatedAt: maintenant.toISOString(),
        updatedByName: auteur.displayName,
      });
    }

    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_STATUS_UPDATED",
      `Ligne devis · ${text(saisie.quoteLineLabel) ?? saisie.quoteLineId} : ${previousStatus === "DONE" ? "Réalisée" : "À faire"} → ${saisie.status === "DONE" ? "Réalisée" : "À faire"}.`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "setOperationalSpaceState") {
    ensureOperationalEditable(element);
    const precedent = element.operational.spaces[saisie.spaceId];
    if (precedent === saisie.state) throw new Error("CHANTIER_OPERATIONAL_SPACE_UNCHANGED");
    element.operational.spaces[saisie.spaceId] = saisie.state;
    touch(element, auteur, maintenant);
    const libelle =
      saisie.spaceId === "workshop"
        ? "Atelier"
        : saisie.spaceId === "install"
          ? "Pose"
          : saisie.spaceId === "meeting"
            ? "Réunion de chantier"
            : saisie.spaceId === "reception"
              ? "Réception"
              : saisie.spaceId === "admin"
                ? "Admin"
                : saisie.spaceId.toUpperCase();
    history(
      element,
      auteur.displayName,
      "OPERATIONAL_SPACE_STATE_UPDATED",
      `${libelle} : ${saisie.state === "NOT_APPLICABLE" ? "déclaré Non concerné" : "réactivé"}.`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "markDone") {
    if (element.status !== "ACTIVE") throw new Error("CHANTIER_NOT_ACTIVE");
    element.status = "DONE";
    element.completedAt = maintenant.toISOString();
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "MARKED_DONE",
      `Chantier passé à Terminé. Motif : ${saisie.reason}. Revue des BC : ${
        saisie.purchaseReview?.decision === "REMOVE"
          ? "engagements non rapprochés retirés"
          : saisie.purchaseReview?.decision === "KEEP"
            ? "engagements non rapprochés conservés"
            : "aucun engagement à revoir"
      }.`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "cancel") {
    if (element.status !== "ACTIVE") throw new Error("CHANTIER_NOT_ACTIVE");
    if (saisie.confirmed !== true) throw new Error("CHANTIER_CANCELLATION_CONFIRMATION_REQUIRED");
    const reason = saisie.reason.trim();
    if (!reason || reason.length > 1000) throw new Error("CHANTIER_CANCELLATION_REASON_REQUIRED");
    element.status = "CANCELLED";
    // Do not mark unfinished work as completed and do not erase hours or quote links.
    element.completedAt = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "CANCELLED",
      `Chantier annulé. Motif : ${reason}`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "reactivate") {
    if (element.status !== "DONE" && element.status !== "CANCELLED")
      throw new Error("CHANTIER_NOT_DONE");
    element.status = "ACTIVE";
    element.completedAt = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "REACTIVATED",
      `Chantier remis en Actif. Motif : ${saisie.reason}`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "archive") {
    if (element.status !== "DONE" && element.status !== "CANCELLED")
      throw new Error("CHANTIER_NOT_DONE");
    element.status = "ARCHIVED";
    element.archivedAt = maintenant.toISOString();
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "ARCHIVED",
      "Chantier archivé après revue des éléments encore ouverts.",
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  if (saisie.action === "unarchive") {
    if (element.status !== "ARCHIVED") throw new Error("CHANTIER_NOT_ARCHIVED");
    element.status = "ACTIVE";
    element.archivedAt = null;
    element.completedAt = null;
    touch(element, auteur, maintenant);
    history(
      element,
      auteur.displayName,
      "UNARCHIVED",
      `Chantier réactivé depuis les archives. Motif : ${saisie.reason}`,
      maintenant,
    );
    return { payload: contenu, focusChantierId: element.id };
  }

  throw new Error(`CHANTIER_MUTATION_UNSUPPORTED_${CHANTIER_STATUS_LABELS[element.status]}`);
}
