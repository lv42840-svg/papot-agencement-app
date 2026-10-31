import { z } from "zod";

const cents = z.number().int().safe().min(0).max(1_000_000_000_00);
const when = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(240);

export const purchaseOrderLineSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1).max(1000),
  quantity: z.number().finite().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  unitPriceHtCents: cents,
}).strict();

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  reference: text,
  chantierId: z.string().uuid(),
  chantierName: text,
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
  z.object({
    mode: z.literal("QUICK"),
    chantierId: z.string().uuid(),
    supplierName: text,
    description: z.string().trim().max(2000),
    amountHtCents: cents.positive(),
  }).strict(),
  z.object({
    mode: z.literal("DETAILED"),
    chantierId: z.string().uuid(),
    supplierName: text,
    description: z.string().trim().max(2000),
    lines: z.array(lineInput).min(1).max(200),
  }).strict(),
]);
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

export function purchaseOrderAmount(input: PurchaseOrderInput): number {
  if (input.mode === "QUICK") return input.amountHtCents;
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
  chantierName: string,
  actor: string,
  now = new Date(),
): PurchaseOrdersPayload {
  if (payload.orders.some((order) => order.requestId === requestId)) return payload;
  const value = purchaseOrderInputSchema.parse(input);
  const amountHtCents = purchaseOrderAmount(value);
  const order: PurchaseOrder = {
    id: crypto.randomUUID(),
    requestId,
    reference: `BC-${String(payload.nextNumber).padStart(6, "0")}`,
    chantierId: value.chantierId,
    chantierName,
    supplierName: value.supplierName,
    mode: value.mode,
    description: value.description,
    quickAmountHtCents: value.mode === "QUICK" ? value.amountHtCents : null,
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
  orders[index] = { ...order, status: "CANCELLED", updatedAt: now.toISOString(), updatedByName: actor };
  return { ...payload, orders };
}

export function committedPurchaseTotal(
  payload: PurchaseOrdersPayload,
  chantierId: string,
): number {
  return payload.orders
    .filter((order) => order.chantierId === chantierId && order.status === "COMMITTED")
    .reduce((total, order) => total + order.amountHtCents, 0);
}
