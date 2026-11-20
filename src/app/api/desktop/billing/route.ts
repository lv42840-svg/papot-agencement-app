import { NextResponse } from "next/server";
import { z } from "zod";
import type { BillingPayload } from "@/lib/billing/domain";

import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import {
  createBillingDraft,
  approveBillingDraft,
  updateBillingDraft,
  updateBillingDocument,
  billingTypeSchema,
  billingDocumentLineSchema,
  billingTitlesSchema,
} from "@/lib/billing/domain";
import { createBillingRepository } from "@/lib/billing/repository";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { buildChantierMarketSources } from "@/lib/billing/market-sources";
import { addBillingExtra, confirmBillingExtra } from "@/lib/billing/extras";
import {
  presentBillingVisa,
  applyBillingVisaPartial,
  recordBillingVisaDecision,
  setBillingVisaRequirement,
  withdrawBillingVisa,
} from "@/lib/billing/visa";
import { billingVisaMethodSchema } from "@/lib/billing/domain";
import { setBillingDraftRetention } from "@/lib/billing/draft-retention";
import { vatRatePercentSchema } from "@/lib/vat";
import { loadBillingSources } from "@/lib/billing/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const billingMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SET_DRAFT_RETENTION"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      mode: z.enum(["PERCENT", "AMOUNT"]),
      value: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("SET_VISA_REQUIREMENT"),
      chantierId: z.string().uuid(),
      required: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("PRESENT_VISA"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      submittedTo: z.string().trim().min(1).max(240),
      submittedNotes: z.string().trim().max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("REVIEW_VISA"),
      draftId: z.string().uuid(),
      version: z.number().int().positive(),
      decision: z.enum(["ACCEPTED", "PARTIAL", "REFUSED"]),
      acceptedHtCents: z.number().int().positive().safe().optional(),
      lineDecisions: z
        .array(
          z
            .object({
              documentLineId: z.string().uuid(),
              acceptedHtCents: z.number().int().nonnegative().safe(),
              reason: z.string().trim().max(1000),
            })
            .strict(),
        )
        .max(1000)
        .optional(),
      reviewMethod: billingVisaMethodSchema,
      externalContact: z.string().trim().min(1).max(240),
      evidence: z.string().trim().min(1).max(2000),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("APPLY_VISA_PARTIAL"),
      draftId: z.string().uuid(),
      version: z.number().int().positive(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("WITHDRAW_VISA"),
      draftId: z.string().uuid(),
      version: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("ADD_EXTRA"),
      requestId: z.string().uuid(),
      chantierId: z.string().uuid(),
      description: z.string().trim().min(1).max(4000),
      amountHtCents: z.number().int().positive().safe(),
      vatRatePercent: vatRatePercentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("CONFIRM_EXTRA"),
      extraId: z.string().uuid(),
      evidence: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("SET_MANUAL_MARKET"),
      chantierId: z.string().uuid(),
      description: z.string().trim().min(1).max(4000),
      amountHtCents: z.number().int().positive().safe(),
      vatRatePercent: vatRatePercentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("SET_TITLES"),
      invoiceTitles: billingTitlesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("CREATE"),
      requestId: z.string().uuid(),
      quoteId: z.string().uuid(),
      chantierId: z.string().uuid().nullable().optional(),
      type: billingTypeSchema,
      amountHtCents: z.number().int().positive().safe().optional(),
      cumulativePercent: z.number().finite().gt(0).max(100).optional(),
      linePercentages: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              percent: z.number().finite().min(0).max(100),
            })
            .strict(),
        )
        .max(1000)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("UPDATE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      label: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(4000),
      amountHtCents: z.number().int().positive().safe().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("UPDATE_DOCUMENT"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      label: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(4000),
      documentLines: z.array(billingDocumentLineSchema).min(1).max(1000),
      linePercentages: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              percent: z.number().finite().min(0).max(100),
            })
            .strict(),
        )
        .max(1000)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("APPROVE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("DELETE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

/** Bank movements and official tax documents require distinct financial permissions.
 * Do not expose the private issued ledger through the ordinary billing workspace.
 */
function publicBillingPayload(payload: BillingPayload): BillingPayload {
  const safe = { ...payload };
  delete safe.financialLedger;
  return safe;
}

function noStoreJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function statusFor(code: string): number {
  const authStatus = desktopRequestErrorStatus(code);
  if (authStatus) return authStatus;
  if (code === "BILLING_DRAFT_NOT_FOUND" || code === "BILLING_QUOTE_NOT_AVAILABLE") return 404;
  if (
    code === "BILLING_MARKET_WITHOUT_CLIENT" ||
    code === "BILLING_MARKET_CLIENT_MISMATCH" ||
    code === "BILLING_MARKET_SOURCE_CONFLICT" ||
    code === "BILLING_MARKET_ALREADY_PREPARED" ||
    code === "BILLING_MARKET_LINES_LIMIT" ||
    code === "BILLING_MARKET_LINE_DUPLICATE" ||
    code === "BILLING_EXTRA_ALREADY_CONFIRMED" ||
    code === "BILLING_EXTRA_MARKET_REQUIRED"
  )
    return 409;
  if (code === "BILLING_EXTRA_NOT_FOUND" || code === "BILLING_VISA_NOT_FOUND") return 404;
  if (code.startsWith("BILLING_VISA_")) return 409;
  if (
    code === "BILLING_VERSION_CONFLICT" ||
    code === "BILLING_AMOUNT_EXCEEDS_CONTRACT" ||
    code === "BILLING_CONTRACT_ALREADY_PREPARED" ||
    code === "BILLING_PROGRESS_CANNOT_DECREASE" ||
    code === "BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE" ||
    code === "BILLING_RETENTION_AFTER_VISA" ||
    code === "BILLING_RETENTION_EXCEEDS_TTC" ||
    code === "BILLING_DRAFT_HAS_DEPENDENTS" ||
    code === "BILLING_DOCUMENT_EDIT_REQUIRED" ||
    code === "BILLING_DRAFT_LOCKED" ||
    code === "BILLING_APPROVAL_TOTALS_MISMATCH"
  )
    return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireModuleRequestContext("billing", "READ");
    const [payload, quotes, chantiers] = await Promise.all([
      createBillingRepository().load(),
      loadBillingSources(),
      createChantiersRepository().load(),
    ]);
    const sources = buildChantierMarketSources(
      chantiers.chantiers,
      quotes,
      payload.manualMarkets ?? [],
      payload.extras ?? [],
    );
    return noStoreJson({
      payload: publicBillingPayload(payload),
      sources,
      chantiers: chantiers.chantiers.map((chantier) => ({
        id: chantier.id,
        name: chantier.name,
        clientName: chantier.clientName,
        status: chantier.status,
      })),
      canWrite: context.moduleAccess.canWrite,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_LOAD_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("billing", "WRITE");
    const parsed = billingMutationSchema.safeParse(await request.json());
    if (!parsed.success) {
      const fields = [
        ...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "root")),
      ];
      return noStoreJson({ error: "BILLING_REQUEST_INVALID", fields }, 400);
    }
    const input = parsed.data;
    const needsMarket =
      input.action === "CREATE" ||
      input.action === "SET_MANUAL_MARKET" ||
      input.action === "ADD_EXTRA" ||
      input.action === "SET_VISA_REQUIREMENT";
    const [quotes, chantiers, commercial, clients] = needsMarket
      ? await Promise.all([
          loadBillingSources(),
          createChantiersRepository().load(),
          createCommercialRepository().load(),
          (await createClientsRepository()).load(),
        ])
      : [[], null, null, null];
    const repository = createBillingRepository();
    const payload = await repository.mutate((current) => {
      const drafts = [...current.drafts];
      if (input.action === "SET_TITLES") {
        return { ...current, invoiceTitles: input.invoiceTitles };
      }
      if (input.action === "SET_DRAFT_RETENTION") {
        return setBillingDraftRetention(current, input, context.user.displayName);
      }
      if (input.action === "SET_VISA_REQUIREMENT") {
        if (!chantiers?.chantiers.some((site) => site.id === input.chantierId)) {
          throw new Error("BILLING_QUOTE_NOT_AVAILABLE");
        }
        if (
          drafts.some(
            (draft) => draft.chantierId === input.chantierId && draft.status === "APPROVED",
          )
        )
          throw new Error("BILLING_VISA_RULE_AFTER_APPROVAL");
        return setBillingVisaRequirement(
          current,
          input.chantierId,
          input.required,
          context.user.displayName,
        );
      }
      if (input.action === "PRESENT_VISA") {
        return presentBillingVisa(current, input, context.user.displayName);
      }
      if (input.action === "REVIEW_VISA") {
        return recordBillingVisaDecision(current, input, context.user.displayName);
      }
      if (input.action === "WITHDRAW_VISA") {
        return withdrawBillingVisa(current, input, context.user.displayName);
      }
      if (input.action === "APPLY_VISA_PARTIAL") {
        return applyBillingVisaPartial(current, input, context.user.displayName);
      }
      if (input.action === "ADD_EXTRA") {
        const sources = buildChantierMarketSources(
          chantiers?.chantiers ?? [],
          quotes,
          current.manualMarkets ?? [],
          current.extras ?? [],
        );
        if (!sources.some((source) => source.chantierId === input.chantierId)) {
          throw new Error("BILLING_EXTRA_MARKET_REQUIRED");
        }
        return addBillingExtra(current, input, context.user.displayName);
      }
      if (input.action === "CONFIRM_EXTRA") {
        return confirmBillingExtra(current, input, context.user.displayName);
      }
      if (input.action === "SET_MANUAL_MARKET") {
        const chantier = chantiers?.chantiers.find((item) => item.id === input.chantierId);
        if (!chantier) throw new Error("BILLING_QUOTE_NOT_AVAILABLE");
        const affair = commercial?.cases.find(
          (item) => item.id === chantier.sourceCommercialCaseId,
        );
        if (
          quotes.some((item) => item.chantierId === chantier.id) ||
          (affair?.retainedQuoteIds.length ?? 0) > 0
        ) {
          throw new Error("BILLING_MARKET_SOURCE_CONFLICT");
        }
        const client = clients?.clients.find((item) => item.id === affair?.clientId);
        if (!affair || !client || client.isArchived) {
          throw new Error("BILLING_MARKET_WITHOUT_CLIENT");
        }
        const markets = [...(current.manualMarkets ?? [])];
        const existingIndex = markets.findIndex((item) => item.chantierId === chantier.id);
        const existing = markets[existingIndex];
        if (
          existing &&
          existing.description === input.description &&
          existing.amountHtCents === input.amountHtCents &&
          existing.vatRatePercent === input.vatRatePercent
        )
          return current;
        if (drafts.some((draft) => draft.chantierId === chantier.id)) {
          throw new Error("BILLING_MARKET_ALREADY_PREPARED");
        }
        const market = {
          chantierId: chantier.id,
          commercialCaseId: chantier.sourceCommercialCaseId,
          clientId: client.id,
          clientName: clientDisplayName(client),
          description: input.description,
          lineId: existing?.lineId ?? globalThis.crypto.randomUUID(),
          amountHtCents: input.amountHtCents,
          vatRatePercent: input.vatRatePercent,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          createdByName: existing?.createdByName ?? context.user.displayName,
        };
        if (existingIndex >= 0) markets[existingIndex] = market;
        else markets.push(market);
        return { ...current, manualMarkets: markets };
      }
      if (input.action === "CREATE") {
        // Request IDs survive retries, including a retry after a connection timeout.
        if (drafts.some((draft) => draft.requestId === input.requestId)) return current;
        const sources = buildChantierMarketSources(
          chantiers?.chantiers ?? [],
          quotes,
          current.manualMarkets ?? [],
          current.extras ?? [],
        );
        const source = sources.find((candidate) => candidate.quoteId === input.quoteId);
        if (!source || (input.chantierId && source.chantierId !== input.chantierId)) {
          throw new Error("BILLING_QUOTE_NOT_AVAILABLE");
        }
        drafts.push(createBillingDraft(current, source, input, context.user.displayName));
      } else if (input.action === "APPROVE") {
        const index = drafts.findIndex((draft) => draft.id === input.draftId);
        if (index < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        drafts[index] = approveBillingDraft(
          current,
          input.draftId,
          input.expectedUpdatedAt,
          context.user.displayName,
        );
      } else if (input.action === "UPDATE_DOCUMENT") {
        const index = drafts.findIndex((draft) => draft.id === input.draftId);
        if (index < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        drafts[index] = updateBillingDocument(
          current,
          input.draftId,
          input,
          context.user.displayName,
        );
      } else if (input.action === "UPDATE") {
        const index = drafts.findIndex((draft) => draft.id === input.draftId);
        if (index < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        drafts[index] = updateBillingDraft(current, input.draftId, input, context.user.displayName);
      } else {
        const index = drafts.findIndex((draft) => draft.id === input.draftId);
        if (index < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        if (drafts[index].status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
        if ((current.visaVersions ?? []).some((visa) => visa.draftId === drafts[index].id)) {
          throw new Error("BILLING_VISA_HISTORY_PROTECTED");
        }
        if (drafts[index].updatedAt !== input.expectedUpdatedAt) {
          throw new Error("BILLING_VERSION_CONFLICT");
        }
        if (
          drafts.slice(index + 1).some((draft) => draft.chantierId === drafts[index].chantierId)
        ) {
          throw new Error("BILLING_DRAFT_HAS_DEPENDENTS");
        }
        drafts.splice(index, 1);
      }
      return { ...current, drafts };
    });
    return noStoreJson({ payload: publicBillingPayload(payload), canWrite: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "root"))];
      console.error("[billing] Invalid stored billing data fields:", fields);
      return noStoreJson({ error: "BILLING_DRAFT_DATA_INVALID", fields }, 422);
    }
    const code = error instanceof Error ? error.message : "BILLING_MUTATION_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}
