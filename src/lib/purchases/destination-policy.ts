import {
  purchaseOrderAllocations,
  purchaseOrderAmount,
  type PurchaseOrder,
  type PurchaseOrderInput,
} from "./domain";

/** Keep historical amounts on closed sites, but do not create or change their commitments. */
export function purchaseChantierNamesForInput(
  input: PurchaseOrderInput,
  sites: readonly { id: string; name: string; status: string }[],
  previous?: PurchaseOrder,
): ReadonlyMap<string, string> {
  const byId = new Map(sites.map((site) => [site.id, site]));
  const before = new Map(
    (previous ? purchaseOrderAllocations(previous) : [])
      .filter((row) => row.chantierId !== null)
      .map((row) => [row.chantierId, row.amountHtCents]),
  );
  const rows =
    input.mode === "QUICK"
      ? input.allocations
      : [{ chantierId: input.chantierId, amountHtCents: purchaseOrderAmount(input) }];
  for (const row of rows) {
    if (row.chantierId === null) continue;
    const site = byId.get(row.chantierId);
    if (!site) throw new Error("PURCHASE_CHANTIER_NOT_FOUND");
    if (site.status !== "ACTIVE" && before.get(site.id) !== row.amountHtCents) {
      throw new Error("PURCHASE_CHANTIER_NOT_ACTIVE");
    }
  }
  // Removing a closed site's allocation is a deliberate close-review action, not a silent edit.
  for (const [id, amount] of before) {
    const site = id ? byId.get(id) : undefined;
    if (site && site.status !== "ACTIVE" && !rows.some((row) => row.chantierId === id && row.amountHtCents === amount)) {
      throw new Error("PURCHASE_CHANTIER_NOT_ACTIVE");
    }
  }
  return new Map(sites.map((site) => [site.id, site.name]));
}
