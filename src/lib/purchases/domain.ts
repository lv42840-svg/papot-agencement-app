import { z } from "zod";

const cents = z.number().int().safe().min(0).max(1_000_000_000_00);
const when = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(240);

export const purchaseOrderLineSchema = z
  .object({
    id: z.string().uuid(),
    description: z.string().trim().min(1).max(1000),
    quantity: z.number().finite().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(40),
    unitPriceHtCents: cents,
  })
  .strict();

export const purchaseOrderAllocationSchema = z
  .object({
    chantierId: z.string().uuid(),
    chantierName: text,
    amountHtCents: cents.positive(),
  })
  .strict();

const quickAllocationsInputSchema = z
  .array(
    z
      .object({
        chantierId: z.string().uuid(),
        amountHtCents: cents.positive(),
      })
      .strict(),
  )
  .min(1)
  .max(100)
  .refine(
    (rows) => new Set(rows.map((row) => row.chantierId)).size === rows.length,
    "PURCHASE_ORDER_DUPLICATE_CHANTIER",
  );

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  reference: text,
  chantierId: z.string().uuid(),
  chantierName: text,
  allocations: z.array(purchaseOrderAllocationSchema).min(1).max(100).optional(),
  removedAllocations: z
    .array(
      purchaseOrderAllocationSchema.extend({
        removedAt: when,
        removedByName: text,
        reason: text,
      }),
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

const lineInput = purchaseOrderLineSchema;
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
      lines: z.array(lineInput).min(1).max(200),
    })
    .strict(),
]);
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

export function purchaseOrderAmount(input: PurchaseOrderInput): number {
  if (input.mode === "QUICK") {
    const total = input.allocations.reduce((sum, item) => sum + item.amountHtCents, 0);
    if (!Number.isSafeInteger(total) || total <= 0 || total > 1_000_000_000_00) {
      throw new Error("PURCHASE_ORDER_AMOUNT_INVALID");
    }
    return total;
  }
  // Round each extended line once in cents, then sum. Reject overflow.
  const sum = input.lines.reduce(
    (total, line) => total + Math.round(line.quantity * line.unitPriceHtCents),
    0,
  );
  if (!Number.isSafeInteger(sum) || sum <= 0 || sum > 1_000_000_000_00) {
    throw new Error("PURCHASE_ORDER_AMOUNT_INVALID");
  }
  return sum;
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
  const allocationInput =
    value.mode === "QUICK" ? value.allocations : [{ chantierId: value.chantierId, amountHtCents }];
  const allocations = allocationInput.map((allocation) => {
    const chantierName = chantierNames.get(allocation.chantierId);
    if (!chantierName) throw new Error("PURCHASE_CHANTIER_NOT_FOUND");
    return { ...allocation, chantierName };
  });
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

export function committedPurchaseTotal(payload: PurchaseOrdersPayload, chantierId: string): number {
  return payload.orders
    .filter((order) => order.status === "COMMITTED")
    .reduce((total, order) => {
      if (order.allocations?.length) {
        return (
          total +
          order.allocations
            .filter((allocation) => allocation.chantierId === chantierId)
            .reduce((sum, allocation) => sum + allocation.amountHtCents, 0)
        );
      }
      // Existing pre-multisite BC remain compatible with their original chantier.
      return total + (order.chantierId === chantierId ? order.amountHtCents : 0);
    }, 0);
}

export type CommittedChantierOrder = {
  orderId: string;
  reference: string;
  supplierName: string;
  amountHtCents: number;
  updatedAt: string;
};

/** Only allocations still committed count, including legacy single-chantier BC. */
export function committedOrdersForChantier(
  payload: PurchaseOrdersPayload,
  chantierId: string,
): CommittedChantierOrder[] {
  return payload.orders.flatMap((order) => {
    if (order.status !== "COMMITTED") return [];
    const amount = order.allocations?.length
      ? order.allocations.find((allocation) => allocation.chantierId === chantierId)?.amountHtCents
      : order.chantierId === chantierId
        ? order.amountHtCents
        : undefined;
    return amount === undefined
      ? []
      : [
          {
            orderId: order.id,
            reference: order.reference,
            supplierName: order.supplierName,
            amountHtCents: amount,
            updatedAt: order.updatedAt,
          },
        ];
  });
}

/**
 * Revoke only the engagement attributed to the closing chantier.
 * Preserve the original BC and auditable removed allocations.
 * Detailed and legacy mono-site BC are soft-cancelled.
 */
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
      if (!order.allocations?.length) {
        if (order.chantierId !== chantierId) return order;
        return {
          ...order,
          status: "CANCELLED" as const,
          updatedAt: at,
          updatedByName: actor,
          removedAllocations: [
            ...(order.removedAllocations ?? []),
            {
              chantierId,
              chantierName: order.chantierName,
              amountHtCents: order.amountHtCents,
              removedAt: at,
              removedByName: actor,
              reason: "Revue des BC à la clôture du chantier",
            },
          ],
        };
      }
      const removed = order.allocations.filter(
        (allocation) => allocation.chantierId === chantierId,
      );
      if (!removed.length) return order;
      const remaining = order.allocations.filter(
        (allocation) => allocation.chantierId !== chantierId,
      );
      const total = remaining.reduce((sum, row) => sum + row.amountHtCents, 0);
      const first = remaining[0];
      return {
        ...order,
        status: (first ? "COMMITTED" : "CANCELLED") as "COMMITTED" | "CANCELLED",
        chantierId: first?.chantierId ?? order.chantierId,
        chantierName: first?.chantierName ?? order.chantierName,
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

/** Optimistic review token detects changes to an order while closing the chantier. */
export function purchaseCloseReviewToken(orders: CommittedChantierOrder[]): string {
  return (
    orders
      .map((order) => [order.orderId, order.updatedAt, order.amountHtCents].join(":"))
      .sort()
      .join("|") || "none"
  );
}

/** Historical chantier-level view, including cancelled and removed BC allocations. */
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
    const allocation = order.allocations?.length
      ? order.allocations.find((item) => item.chantierId === chantierId)
      : order.chantierId === chantierId
        ? { amountHtCents: order.amountHtCents }
        : undefined;
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
