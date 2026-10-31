import { z } from "zod";

const cents = z.number().int().safe().min(0).max(1_000_000_000_00);
const when = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(240);

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

function validateDestination(value: Destination, ctx: z.RefinementCtx) {
  const kind = value.destinationType ?? "CHANTIER";
  if ((kind === "CHANTIER") !== (value.chantierId !== null)) {
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
  selection: string,
  amountHtCents: number,
): PurchaseAllocationInput {
  return purchaseAllocationInputSchema.parse(
    selection === "SAV" || selection === "GENERAL_EXPENSES"
      ? { destinationType: selection, chantierId: null, amountHtCents }
      : { destinationType: "CHANTIER", chantierId: selection, amountHtCents },
  );
}

const allocationBase = allocationInputBase.extend({ chantierName: text });
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
    (rows) => new Set(rows.map(purchaseDestinationKey)).size === rows.length,
    "PURCHASE_ORDER_DUPLICATE_CHANTIER",
  );

export const purchaseOrderSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    reference: text,
    chantierId: z.string().uuid().nullable(),
    chantierName: text,
    allocations: z.array(purchaseOrderAllocationSchema).min(1).max(100).optional(),
    revisions: z
      .array(
        z.object({
          changedAt: when,
          changedByName: text,
          previousSupplierName: text,
          previousAmountHtCents: cents,
          previousChantierIds: z.array(z.string().uuid()),
          previousAllocations: z.array(purchaseOrderAllocationSchema).optional(),
        }),
      )
      .optional(),
    removedAllocations: z
      .array(
        allocationBase
          .extend({ removedAt: when, removedByName: text, reason: text })
          .superRefine(validateDestination),
      )
      .optional(),
    supplierName: text,
    mode: z.enum(["QUICK", "DETAILED"]),
    description: z.string().trim().max(2000),
    quickAmountHtCents: cents.nullable(),
    lines: z.array(purchaseOrderLineSchema).max(200),
    amountHtCents: cents,
    status: z.enum(["COMMITTED", "CANCELLED"]),
    createdAt: when,
    createdByName: text,
    updatedAt: when,
    updatedByName: text,
  })
  .superRefine((order, ctx) => {
    if (order.mode === "DETAILED" && order.chantierId === null) {
      ctx.addIssue({ code: "custom", message: "PURCHASE_DETAILED_CHANTIER_REQUIRED" });
    }
    if (!order.allocations?.length) {
      if (order.chantierId === null) {
        ctx.addIssue({ code: "custom", message: "PURCHASE_DESTINATION_REQUIRED" });
      }
      return;
    }
    const allocations = order.allocations;
    if (
      allocations.reduce((sum, row) => sum + row.amountHtCents, 0) !== order.amountHtCents ||
      new Set(allocations.map(purchaseDestinationKey)).size !== allocations.length ||
      order.chantierId !== allocations[0].chantierId
    ) {
      ctx.addIssue({ code: "custom", message: "PURCHASE_ALLOCATION_TOTAL_INVALID" });
    }
    if (
      order.mode === "DETAILED" &&
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

export function parsePurchaseOrdersPayload(value: unknown): PurchaseOrdersPayload {
  if (value === null || value === undefined) {
    return { schemaVersion: 1, nextNumber: 1, orders: [] };
  }
  return purchaseOrdersPayloadSchema.parse(value);
}

export const purchaseOrderInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("QUICK"),
      allocations: quickAllocationsInputSchema,
      supplierName: text,
      description: z.string().trim().max(2000),
    })
    .strict(),
  z
    .object({
      mode: z.literal("DETAILED"),
      chantierId: z.string().uuid(),
      supplierName: text,
      description: z.string().trim().max(2000),
      lines: z.array(purchaseOrderLineSchema).min(1).max(200),
    })
    .strict(),
]);
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

export function purchaseOrderAmount(input: PurchaseOrderInput): number {
  const total =
    input.mode === "QUICK"
      ? input.allocations.reduce((sum, item) => sum + item.amountHtCents, 0)
      : input.lines.reduce(
          (sum, line) => sum + Math.round(line.quantity * line.unitPriceHtCents),
          0,
        );
  if (!Number.isSafeInteger(total) || total <= 0 || total > 1_000_000_000_00) {
    throw new Error("PURCHASE_ORDER_AMOUNT_INVALID");
  }
  return total;
}

function resolveAllocations(
  rows: readonly PurchaseAllocationInput[],
  chantierNames: ReadonlyMap<string, string>,
): PurchaseOrderAllocation[] {
  return rows.map((row) => {
    const kind = row.destinationType ?? "CHANTIER";
    const chantierName =
      kind === "SAV"
        ? "SAV"
        : kind === "GENERAL_EXPENSES"
          ? "Frais généraux"
          : chantierNames.get(row.chantierId ?? "");
    if (!chantierName) throw new Error("PURCHASE_CHANTIER_NOT_FOUND");
    return { ...row, chantierName };
  });
}

/** Each order is represented exactly once, either by its allocations or its legacy header. */
export function purchaseOrderAllocations(order: PurchaseOrder): PurchaseOrderAllocation[] {
  if (order.allocations?.length) return order.allocations;
  return [
    {
      chantierId: order.chantierId,
      chantierName: order.chantierName,
      amountHtCents: order.amountHtCents,
    },
  ];
}

export function addPurchaseOrder(
  payload: PurchaseOrdersPayload,
  requestId: string,
  input: PurchaseOrderInput,
  chantierNames: ReadonlyMap<string, string>,
  actor: string,
  now = new Date(),
): PurchaseOrdersPayload {
  if (payload.orders.some((order) => order.requestId === requestId)) return payload;
  const value = purchaseOrderInputSchema.parse(input);
  const amountHtCents = purchaseOrderAmount(value);
  const allocations = resolveAllocations(
    value.mode === "QUICK" ? value.allocations : [{ chantierId: value.chantierId, amountHtCents }],
    chantierNames,
  );
  const primary = allocations[0];
  const order: PurchaseOrder = {
    id: crypto.randomUUID(),
    requestId,
    reference: `BC-${String(payload.nextNumber).padStart(6, "0")}`,
    chantierId: primary.chantierId,
    chantierName: primary.chantierName,
    allocations: value.mode === "QUICK" ? allocations : undefined,
    supplierName: value.supplierName,
    mode: value.mode,
    description: value.description,
    quickAmountHtCents: value.mode === "QUICK" ? amountHtCents : null,
    lines: value.mode === "DETAILED" ? value.lines : [],
    amountHtCents,
    status: "COMMITTED",
    createdAt: now.toISOString(),
    createdByName: actor,
    updatedAt: now.toISOString(),
    updatedByName: actor,
  };
  return { ...payload, nextNumber: payload.nextNumber + 1, orders: [...payload.orders, order] };
}

export function cancelPurchaseOrder(
  payload: PurchaseOrdersPayload,
  orderId: string,
  expectedUpdatedAt: string,
  actor: string,
  now = new Date(),
): PurchaseOrdersPayload {
  const index = payload.orders.findIndex((order) => order.id === orderId);
  if (index < 0) throw new Error("PURCHASE_ORDER_NOT_FOUND");
  const order = payload.orders[index];
  if (order.updatedAt !== expectedUpdatedAt) throw new Error("PURCHASE_ORDER_VERSION_CONFLICT");
  if (order.status === "CANCELLED") throw new Error("PURCHASE_ORDER_ALREADY_CANCELLED");
  const orders = [...payload.orders];
  orders[index] = {
    ...order,
    status: "CANCELLED",
    updatedAt: now.toISOString(),
    updatedByName: actor,
  };
  return { ...payload, orders };
}

export function committedPurchaseDestinationTotal(
  payload: PurchaseOrdersPayload,
  destination: string,
): number {
  return payload.orders
    .filter((order) => order.status === "COMMITTED")
    .reduce(
      (total, order) =>
        total +
        purchaseOrderAllocations(order)
          .filter((allocation) => purchaseDestinationKey(allocation) === destination)
          .reduce((sum, allocation) => sum + allocation.amountHtCents, 0),
      0,
    );
}

export function committedPurchaseTotal(payload: PurchaseOrdersPayload, chantierId: string): number {
  return payload.orders
    .filter((order) => order.status === "COMMITTED")
    .reduce(
      (total, order) =>
        total +
        purchaseOrderAllocations(order)
          .filter(
            (allocation) =>
              (allocation.destinationType ?? "CHANTIER") === "CHANTIER" &&
              allocation.chantierId === chantierId,
          )
          .reduce((sum, allocation) => sum + allocation.amountHtCents, 0),
      0,
    );
}

/** Current commitments, all dates. Never a monthly invoiced expense or a bank movement. */
export function committedPurchasesByDestination(payload: PurchaseOrdersPayload) {
  const result = { chantierCents: 0, savCents: 0, generalExpensesCents: 0, totalCents: 0 };
  for (const order of parsePurchaseOrdersPayload(payload).orders) {
    if (order.status !== "COMMITTED") continue;
    for (const row of purchaseOrderAllocations(order)) {
      const kind = row.destinationType ?? "CHANTIER";
      const key =
        kind === "SAV"
          ? "savCents"
          : kind === "GENERAL_EXPENSES"
            ? "generalExpensesCents"
            : "chantierCents";
      result[key] += row.amountHtCents;
      result.totalCents += row.amountHtCents;
      if (!Number.isSafeInteger(result.totalCents))
        throw new Error("PURCHASE_ORDER_AMOUNT_INVALID");
    }
  }
  return result;
}

export type CommittedChantierOrder = {
  orderId: string;
  reference: string;
  supplierName: string;
  amountHtCents: number;
  updatedAt: string;
};

export function committedOrdersForChantier(
  payload: PurchaseOrdersPayload,
  chantierId: string,
): CommittedChantierOrder[] {
  return payload.orders.flatMap((order) => {
    if (order.status !== "COMMITTED") return [];
    const allocation = purchaseOrderAllocations(order).find(
      (row) => (row.destinationType ?? "CHANTIER") === "CHANTIER" && row.chantierId === chantierId,
    );
    return allocation
      ? [
          {
            orderId: order.id,
            reference: order.reference,
            supplierName: order.supplierName,
            amountHtCents: allocation.amountHtCents,
            updatedAt: order.updatedAt,
          },
        ]
      : [];
  });
}

/** Closing a chantier removes only its own commitment, never the SAV/FG allocations. */
export function removeChantierPurchaseCommitments(
  payload: PurchaseOrdersPayload,
  chantierId: string,
  actor: string,
  now = new Date(),
): PurchaseOrdersPayload {
  const at = now.toISOString();
  return {
    ...payload,
    orders: payload.orders.map((order) => {
      if (order.status !== "COMMITTED") return order;
      const allocations = purchaseOrderAllocations(order);
      const removed = allocations.filter((allocation) => allocation.chantierId === chantierId);
      if (!removed.length) return order;
      const remaining = allocations.filter((allocation) => allocation.chantierId !== chantierId);
      const total = remaining.reduce((sum, row) => sum + row.amountHtCents, 0);
      const first = remaining[0];
      return {
        ...order,
        status: (first ? "COMMITTED" : "CANCELLED") as "COMMITTED" | "CANCELLED",
        chantierId: first ? first.chantierId : order.chantierId,
        chantierName: first ? first.chantierName : order.chantierName,
        allocations: first ? remaining : order.allocations,
        amountHtCents: first ? total : order.amountHtCents,
        quickAmountHtCents: first ? total : order.quickAmountHtCents,
        updatedAt: at,
        updatedByName: actor,
        removedAllocations: [
          ...(order.removedAllocations ?? []),
          ...removed.map((allocation) => ({
            ...allocation,
            removedAt: at,
            removedByName: actor,
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
      .map((order) => [order.orderId, order.updatedAt, order.amountHtCents].join(":"))
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
  payload: PurchaseOrdersPayload,
  chantierId: string,
): ChantierPurchaseHistoryEntry[] {
  return payload.orders.flatMap<ChantierPurchaseHistoryEntry>((order) => {
    const removed = (order.removedAllocations ?? []).filter(
      (allocation) => allocation.chantierId === chantierId,
    );
    if (removed.length > 0) {
      return [
        {
          order,
          amountHtCents: removed.reduce((sum, item) => sum + item.amountHtCents, 0),
          state: "REMOVED" as const,
          removedAt: removed[removed.length - 1].removedAt,
        },
      ];
    }
    const allocation = purchaseOrderAllocations(order).find(
      (item) => item.chantierId === chantierId,
    );
    if (!allocation) return [];
    return [
      {
        order,
        amountHtCents: allocation.amountHtCents,
        state: order.status === "COMMITTED" ? ("COMMITTED" as const) : ("CANCELLED" as const),
        removedAt: null,
      },
    ];
  });
}

export function updatePurchaseOrder(
  payload: PurchaseOrdersPayload,
  orderId: string,
  expectedUpdatedAt: string,
  input: PurchaseOrderInput,
  chantierNames: ReadonlyMap<string, string>,
  actor: string,
  now = new Date(),
): PurchaseOrdersPayload {
  const index = payload.orders.findIndex((order) => order.id === orderId);
  if (index < 0) throw new Error("PURCHASE_ORDER_NOT_FOUND");
  const original = payload.orders[index];
  if (original.updatedAt !== expectedUpdatedAt) throw new Error("PURCHASE_ORDER_VERSION_CONFLICT");
  if (original.status === "CANCELLED" || original.removedAllocations?.length) {
    throw new Error("PURCHASE_ORDER_NOT_EDITABLE");
  }
  const value = purchaseOrderInputSchema.parse(input);
  if (value.mode !== original.mode) throw new Error("PURCHASE_ORDER_MODE_IMMUTABLE");
  const amountHtCents = purchaseOrderAmount(value);
  const allocations = resolveAllocations(
    value.mode === "QUICK" ? value.allocations : [{ chantierId: value.chantierId, amountHtCents }],
    chantierNames,
  );
  const previousAllocations = purchaseOrderAllocations(original);
  const primary = allocations[0];
  const next: PurchaseOrder = {
    ...original,
    chantierId: primary.chantierId,
    chantierName: primary.chantierName,
    allocations: value.mode === "QUICK" ? allocations : undefined,
    supplierName: value.supplierName,
    description: value.description,
    quickAmountHtCents: value.mode === "QUICK" ? amountHtCents : null,
    lines: value.mode === "DETAILED" ? value.lines : [],
    amountHtCents,
    revisions: [
      ...(original.revisions ?? []),
      {
        changedAt: now.toISOString(),
        changedByName: actor,
        previousSupplierName: original.supplierName,
        previousAmountHtCents: original.amountHtCents,
        previousChantierIds: previousAllocations
          .map((item) => item.chantierId)
          .filter((id): id is string => id !== null),
        previousAllocations: structuredClone(previousAllocations),
      },
    ],
    updatedAt: now.toISOString(),
    updatedByName: actor,
  };
  const orders = [...payload.orders];
  orders[index] = next;
  return { ...payload, orders };
}
