import { z } from "zod";

const cents = z.number().int().safe().min(0).max(1_000_000_000_00);
const when = z.string().datetime({ offset: true });
const texte = z.string().trim().min(1).max(240);

export const purchaseDestinationTypeSchema = z.enum(["CHANTIER", "SAV", "GENERAL_EXPENSES"]);
export type PurchaseDestinationType = z.infer<typeof purchaseDestinationTypeSchema>;

type Destination = {
  chantierId: string | null;
  destinationType?: PurchaseDestinationType;
};

/** Missing destinationType is the original, backwards-compatible chantier allocation. */
export function purchaseDestinationKey(destination: Destination): string {
  return destination.destinationType && destination.destinationType !== "CHANTIER"
    ? destination.destinationType
    : (destination.chantierId ?? "");
}

function validateDestination(valeur: Destination, ctx: z.RefinementCtx) {
  const kind = valeur.destinationType ?? "CHANTIER";
  if ((kind === "CHANTIER") !== (valeur.chantierId !== null)) {
    ctx.addIssue({ code: "custom", message: "PURCHASE_DESTINATION_INVALID" });
  }
}

const allocationInputBase = z
  .object({
    destinationType: purchaseDestinationTypeSchema.optional(),
    chantierId: z.string().uuid().nullable(),
    amountHtCents: cents.positive(),
  })
  .strict();

export const purchaseAllocationInputSchema = allocationInputBase.superRefine(validateDestination);
export type PurchaseAllocationInput = z.infer<typeof purchaseAllocationInputSchema>;

/** UI selection tokens are converted into explicit destinations, never fake chantier IDs. */
export function purchaseAllocationFromSelection(
  selectionCourante: string,
  amountHtCents: number,
): PurchaseAllocationInput {
  return purchaseAllocationInputSchema.parse(
    selectionCourante === "SAV" || selectionCourante === "GENERAL_EXPENSES"
      ? { destinationType: selectionCourante, chantierId: null, amountHtCents }
      : { destinationType: "CHANTIER", chantierId: selectionCourante, amountHtCents },
  );
}

const allocationBase = allocationInputBase.extend({ chantierName: texte });
export const purchaseOrderAllocationSchema = allocationBase.superRefine(validateDestination);
export type PurchaseOrderAllocation = z.infer<typeof purchaseOrderAllocationSchema>;

export const purchaseOrderLineSchema = z
  .object({
    id: z.string().uuid(),
    description: z.string().trim().min(1).max(1000),
    quantity: z.number().finite().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(40),
    unitPriceHtCents: cents,
  })
  .strict();

const quickAllocationsInputSchema = z
  .array(purchaseAllocationInputSchema)
  .min(1)
  .max(100)
  .refine(
    (lignesTableau) =>
      new Set(lignesTableau.map(purchaseDestinationKey)).size === lignesTableau.length,
    "PURCHASE_ORDER_DUPLICATE_CHANTIER",
  );

export const purchaseOrderSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    reference: texte,
    chantierId: z.string().uuid().nullable(),
    chantierName: texte,
    allocations: z.array(purchaseOrderAllocationSchema).min(1).max(100).optional(),
    revisions: z
      .array(
        z.object({
          changedAt: when,
          changedByName: texte,
          previousSupplierName: texte,
          previousAmountHtCents: cents,
          previousChantierIds: z.array(z.string().uuid()),
          previousAllocations: z.array(purchaseOrderAllocationSchema).optional(),
        }),
      )
      .optional(),
    removedAllocations: z
      .array(
        allocationBase
          .extend({ removedAt: when, removedByName: texte, reason: texte })
          .superRefine(validateDestination),
      )
      .optional(),
    supplierName: texte,
    mode: z.enum(["QUICK", "DETAILED"]),
    description: z.string().trim().max(2000),
    quickAmountHtCents: cents.nullable(),
    lines: z.array(purchaseOrderLineSchema).max(200),
    amountHtCents: cents,
    status: z.enum(["COMMITTED", "CANCELLED"]),
    createdAt: when,
    createdByName: texte,
    updatedAt: when,
    updatedByName: texte,
  })
  .superRefine((commande, ctx) => {
    if (commande.mode === "DETAILED" && commande.chantierId === null) {
      ctx.addIssue({ code: "custom", message: "PURCHASE_DETAILED_CHANTIER_REQUIRED" });
    }
    if (!commande.allocations?.length) {
      if (commande.chantierId === null) {
        ctx.addIssue({ code: "custom", message: "PURCHASE_DESTINATION_REQUIRED" });
      }
      return;
    }
    const allocations = commande.allocations;
    if (
      allocations.reduce((somme, ligneTableau) => somme + ligneTableau.amountHtCents, 0) !==
        commande.amountHtCents ||
      new Set(allocations.map(purchaseDestinationKey)).size !== allocations.length ||
      commande.chantierId !== allocations[0].chantierId
    ) {
      ctx.addIssue({ code: "custom", message: "PURCHASE_ALLOCATION_TOTAL_INVALID" });
    }
    if (
      commande.mode === "DETAILED" &&
      (allocations.length !== 1 || (allocations[0].destinationType ?? "CHANTIER") !== "CHANTIER")
    ) {
      ctx.addIssue({ code: "custom", message: "PURCHASE_DETAILED_CHANTIER_REQUIRED" });
    }
  });
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrdersPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  nextNumber: z.number().int().positive().safe(),
  orders: z.array(purchaseOrderSchema),
});
export type PurchaseOrdersPayload = z.infer<typeof purchaseOrdersPayloadSchema>;

export function parsePurchaseOrdersPayload(valeur: unknown): PurchaseOrdersPayload {
  if (valeur === null || valeur === undefined) {
    return { schemaVersion: 1, nextNumber: 1, orders: [] };
  }
  return purchaseOrdersPayloadSchema.parse(valeur);
}

export const purchaseOrderInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("QUICK"),
      allocations: quickAllocationsInputSchema,
      supplierName: texte,
      description: z.string().trim().max(2000),
    })
    .strict(),
  z
    .object({
      mode: z.literal("DETAILED"),
      chantierId: z.string().uuid(),
      supplierName: texte,
      description: z.string().trim().max(2000),
      lines: z.array(purchaseOrderLineSchema).min(1).max(200),
    })
    .strict(),
]);
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

export function purchaseOrderAmount(saisie: PurchaseOrderInput): number {
  const total =
    saisie.mode === "QUICK"
      ? saisie.allocations.reduce((somme, element) => somme + element.amountHtCents, 0)
      : saisie.lines.reduce(
          (somme, ligne) => somme + Math.round(ligne.quantity * ligne.unitPriceHtCents),
          0,
        );
  if (!Number.isSafeInteger(total) || total <= 0 || total > 1_000_000_000_00) {
    throw new Error("PURCHASE_ORDER_AMOUNT_INVALID");
  }
  return total;
}

function resolveAllocations(
  lignesTableau: readonly PurchaseAllocationInput[],
  chantierNames: ReadonlyMap<string, string>,
): PurchaseOrderAllocation[] {
  return lignesTableau.map((ligneTableau) => {
    const kind = ligneTableau.destinationType ?? "CHANTIER";
    const chantierName =
      kind === "SAV"
        ? "SAV"
        : kind === "GENERAL_EXPENSES"
          ? "Frais généraux"
          : chantierNames.get(ligneTableau.chantierId ?? "");
    if (!chantierName) throw new Error("PURCHASE_CHANTIER_NOT_FOUND");
    return { ...ligneTableau, chantierName };
  });
}

/** Each order is represented exactly once, either by its allocations or its legacy header. */
export function purchaseOrderAllocations(commande: PurchaseOrder): PurchaseOrderAllocation[] {
  if (commande.allocations?.length) return commande.allocations;
  return [
    {
      chantierId: commande.chantierId,
      chantierName: commande.chantierName,
      amountHtCents: commande.amountHtCents,
    },
  ];
}

export function addPurchaseOrder(
  contenu: PurchaseOrdersPayload,
  requestId: string,
  saisie: PurchaseOrderInput,
  chantierNames: ReadonlyMap<string, string>,
  auteur: string,
  maintenant = new Date(),
): PurchaseOrdersPayload {
  if (contenu.orders.some((commande) => commande.requestId === requestId)) return contenu;
  const valeur = purchaseOrderInputSchema.parse(saisie);
  const amountHtCents = purchaseOrderAmount(valeur);
  const allocations = resolveAllocations(
    valeur.mode === "QUICK"
      ? valeur.allocations
      : [{ chantierId: valeur.chantierId, amountHtCents }],
    chantierNames,
  );
  const primary = allocations[0];
  const commande: PurchaseOrder = {
    id: crypto.randomUUID(),
    requestId,
    reference: `BC-${String(contenu.nextNumber).padStart(6, "0")}`,
    chantierId: primary.chantierId,
    chantierName: primary.chantierName,
    allocations: valeur.mode === "QUICK" ? allocations : undefined,
    supplierName: valeur.supplierName,
    mode: valeur.mode,
    description: valeur.description,
    quickAmountHtCents: valeur.mode === "QUICK" ? amountHtCents : null,
    lines: valeur.mode === "DETAILED" ? valeur.lines : [],
    amountHtCents,
    status: "COMMITTED",
    createdAt: maintenant.toISOString(),
    createdByName: auteur,
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur,
  };
  return { ...contenu, nextNumber: contenu.nextNumber + 1, orders: [...contenu.orders, commande] };
}

export function cancelPurchaseOrder(
  contenu: PurchaseOrdersPayload,
  idCommande: string,
  expectedUpdatedAt: string,
  auteur: string,
  maintenant = new Date(),
): PurchaseOrdersPayload {
  const indice = contenu.orders.findIndex((commande) => commande.id === idCommande);
  if (indice < 0) throw new Error("PURCHASE_ORDER_NOT_FOUND");
  const commande = contenu.orders[indice];
  if (commande.updatedAt !== expectedUpdatedAt) throw new Error("PURCHASE_ORDER_VERSION_CONFLICT");
  if (commande.status === "CANCELLED") throw new Error("PURCHASE_ORDER_ALREADY_CANCELLED");
  const orders = [...contenu.orders];
  orders[indice] = {
    ...commande,
    status: "CANCELLED",
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur,
  };
  return { ...contenu, orders };
}

export function committedPurchaseDestinationTotal(
  contenu: PurchaseOrdersPayload,
  destination: string,
): number {
  return contenu.orders
    .filter((commande) => commande.status === "COMMITTED")
    .reduce(
      (total, commande) =>
        total +
        purchaseOrderAllocations(commande)
          .filter((allocation) => purchaseDestinationKey(allocation) === destination)
          .reduce((somme, allocation) => somme + allocation.amountHtCents, 0),
      0,
    );
}

export function committedPurchaseTotal(contenu: PurchaseOrdersPayload, chantierId: string): number {
  return contenu.orders
    .filter((commande) => commande.status === "COMMITTED")
    .reduce(
      (total, commande) =>
        total +
        purchaseOrderAllocations(commande)
          .filter(
            (allocation) =>
              (allocation.destinationType ?? "CHANTIER") === "CHANTIER" &&
              allocation.chantierId === chantierId,
          )
          .reduce((somme, allocation) => somme + allocation.amountHtCents, 0),
      0,
    );
}

/** Current commitments, all dates. Never a monthly invoiced expense or a bank movement. */
export function committedPurchasesByDestination(contenu: PurchaseOrdersPayload) {
  const resultat = { chantierCents: 0, savCents: 0, generalExpensesCents: 0, totalCents: 0 };
  for (const commande of parsePurchaseOrdersPayload(contenu).orders) {
    if (commande.status !== "COMMITTED") continue;
    for (const ligneTableau of purchaseOrderAllocations(commande)) {
      const kind = ligneTableau.destinationType ?? "CHANTIER";
      const cle =
        kind === "SAV"
          ? "savCents"
          : kind === "GENERAL_EXPENSES"
            ? "generalExpensesCents"
            : "chantierCents";
      resultat[cle] += ligneTableau.amountHtCents;
      resultat.totalCents += ligneTableau.amountHtCents;
      if (!Number.isSafeInteger(resultat.totalCents))
        throw new Error("PURCHASE_ORDER_AMOUNT_INVALID");
    }
  }
  return resultat;
}

export type CommittedChantierOrder = {
  orderId: string;
  reference: string;
  supplierName: string;
  amountHtCents: number;
  updatedAt: string;
};

export function committedOrdersForChantier(
  contenu: PurchaseOrdersPayload,
  chantierId: string,
): CommittedChantierOrder[] {
  return contenu.orders.flatMap((commande) => {
    if (commande.status !== "COMMITTED") return [];
    const allocation = purchaseOrderAllocations(commande).find(
      (ligneTableau) =>
        (ligneTableau.destinationType ?? "CHANTIER") === "CHANTIER" &&
        ligneTableau.chantierId === chantierId,
    );
    return allocation
      ? [
          {
            orderId: commande.id,
            reference: commande.reference,
            supplierName: commande.supplierName,
            amountHtCents: allocation.amountHtCents,
            updatedAt: commande.updatedAt,
          },
        ]
      : [];
  });
}

/** Closing a chantier removes only its own commitment, never the SAV/FG allocations. */
export function removeChantierPurchaseCommitments(
  contenu: PurchaseOrdersPayload,
  chantierId: string,
  auteur: string,
  maintenant = new Date(),
): PurchaseOrdersPayload {
  const at = maintenant.toISOString();
  return {
    ...contenu,
    orders: contenu.orders.map((commande) => {
      if (commande.status !== "COMMITTED") return commande;
      const allocations = purchaseOrderAllocations(commande);
      const removed = allocations.filter((allocation) => allocation.chantierId === chantierId);
      if (!removed.length) return commande;
      const remaining = allocations.filter((allocation) => allocation.chantierId !== chantierId);
      const total = remaining.reduce(
        (somme, ligneTableau) => somme + ligneTableau.amountHtCents,
        0,
      );
      const first = remaining[0];
      return {
        ...commande,
        status: (first ? "COMMITTED" : "CANCELLED") as "COMMITTED" | "CANCELLED",
        chantierId: first ? first.chantierId : commande.chantierId,
        chantierName: first ? first.chantierName : commande.chantierName,
        allocations: first ? remaining : commande.allocations,
        amountHtCents: first ? total : commande.amountHtCents,
        quickAmountHtCents: first ? total : commande.quickAmountHtCents,
        updatedAt: at,
        updatedByName: auteur,
        removedAllocations: [
          ...(commande.removedAllocations ?? []),
          ...removed.map((allocation) => ({
            ...allocation,
            removedAt: at,
            removedByName: auteur,
            reason: "Revue des BC à la clôture du chantier",
          })),
        ],
      };
    }),
  };
}

export function purchaseCloseReviewToken(orders: CommittedChantierOrder[]): string {
  return (
    orders
      .map((commande) => [commande.orderId, commande.updatedAt, commande.amountHtCents].join(":"))
      .sort()
      .join("|") || "none"
  );
}

export type ChantierPurchaseHistoryEntry = {
  order: PurchaseOrder;
  amountHtCents: number;
  state: "COMMITTED" | "REMOVED" | "CANCELLED";
  removedAt: string | null;
};

export function purchaseOrderHistoryForChantier(
  contenu: PurchaseOrdersPayload,
  chantierId: string,
): ChantierPurchaseHistoryEntry[] {
  return contenu.orders.flatMap<ChantierPurchaseHistoryEntry>((commande) => {
    const removed = (commande.removedAllocations ?? []).filter(
      (allocation) => allocation.chantierId === chantierId,
    );
    if (removed.length > 0) {
      return [
        {
          order: commande,
          amountHtCents: removed.reduce((somme, element) => somme + element.amountHtCents, 0),
          state: "REMOVED" as const,
          removedAt: removed[removed.length - 1].removedAt,
        },
      ];
    }
    const allocation = purchaseOrderAllocations(commande).find(
      (element) => element.chantierId === chantierId,
    );
    if (!allocation) return [];
    return [
      {
        order: commande,
        amountHtCents: allocation.amountHtCents,
        state: commande.status === "COMMITTED" ? ("COMMITTED" as const) : ("CANCELLED" as const),
        removedAt: null,
      },
    ];
  });
}

export function updatePurchaseOrder(
  contenu: PurchaseOrdersPayload,
  idCommande: string,
  expectedUpdatedAt: string,
  saisie: PurchaseOrderInput,
  chantierNames: ReadonlyMap<string, string>,
  auteur: string,
  maintenant = new Date(),
): PurchaseOrdersPayload {
  const indice = contenu.orders.findIndex((commande) => commande.id === idCommande);
  if (indice < 0) throw new Error("PURCHASE_ORDER_NOT_FOUND");
  const original = contenu.orders[indice];
  if (original.updatedAt !== expectedUpdatedAt) throw new Error("PURCHASE_ORDER_VERSION_CONFLICT");
  if (original.status === "CANCELLED" || original.removedAllocations?.length) {
    throw new Error("PURCHASE_ORDER_NOT_EDITABLE");
  }
  const valeur = purchaseOrderInputSchema.parse(saisie);
  if (valeur.mode !== original.mode) throw new Error("PURCHASE_ORDER_MODE_IMMUTABLE");
  const amountHtCents = purchaseOrderAmount(valeur);
  const allocations = resolveAllocations(
    valeur.mode === "QUICK"
      ? valeur.allocations
      : [{ chantierId: valeur.chantierId, amountHtCents }],
    chantierNames,
  );
  const previousAllocations = purchaseOrderAllocations(original);
  const primary = allocations[0];
  const suivant: PurchaseOrder = {
    ...original,
    chantierId: primary.chantierId,
    chantierName: primary.chantierName,
    allocations: valeur.mode === "QUICK" ? allocations : undefined,
    supplierName: valeur.supplierName,
    description: valeur.description,
    quickAmountHtCents: valeur.mode === "QUICK" ? amountHtCents : null,
    lines: valeur.mode === "DETAILED" ? valeur.lines : [],
    amountHtCents,
    revisions: [
      ...(original.revisions ?? []),
      {
        changedAt: maintenant.toISOString(),
        changedByName: auteur,
        previousSupplierName: original.supplierName,
        previousAmountHtCents: original.amountHtCents,
        previousChantierIds: previousAllocations
          .map((element) => element.chantierId)
          .filter((id): id is string => id !== null),
        previousAllocations: structuredClone(previousAllocations),
      },
    ],
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur,
  };
  const orders = [...contenu.orders];
  orders[indice] = suivant;
  return { ...contenu, orders };
}
