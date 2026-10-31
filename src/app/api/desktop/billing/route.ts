import { NextResponse } from "next/server";
import { z } from "zod";

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
} from "@/lib/billing/domain";
import { createBillingRepository } from "@/lib/billing/repository";
import { loadBillingSources } from "@/lib/billing/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const billingMutationSchema = z.discriminatedUnion("action", [
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
  z.object({
    action: z.literal("APPROVE"),
    draftId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }).strict(),
  z
    .object({
      action: z.literal("DELETE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

function noStoreJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function statusFor(code: string): number {
  const authStatus = desktopRequestErrorStatus(code);
  if (authStatus) return authStatus;
  if (code === "BILLING_DRAFT_NOT_FOUND" || code === "BILLING_QUOTE_NOT_AVAILABLE") return 404;
  if (
    code === "BILLING_VERSION_CONFLICT" ||
    code === "BILLING_AMOUNT_EXCEEDS_CONTRACT" ||
    code === "BILLING_CONTRACT_ALREADY_PREPARED" ||
    code === "BILLING_PROGRESS_CANNOT_DECREASE" ||
    code === "BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE" ||
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
    const [payload, sources] = await Promise.all([
      createBillingRepository().load(),
      loadBillingSources(),
    ]);
    return noStoreJson({ payload, sources, canWrite: context.moduleAccess.canWrite });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_LOAD_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("billing", "WRITE");
    const input = billingMutationSchema.parse(await request.json());
    const sources = input.action === "CREATE" ? await loadBillingSources() : [];
    const repository = createBillingRepository();
    const payload = await repository.mutate((current) => {
      const drafts = [...current.drafts];
      if (input.action === "CREATE") {
        // Request IDs survive retries, including a retry after a connection timeout.
        if (drafts.some((draft) => draft.requestId === input.requestId)) return current;
        const source = sources.find((candidate) => candidate.quoteId === input.quoteId);
        if (!source || (input.chantierId && source.chantierId !== input.chantierId)) {
          throw new Error("BILLING_QUOTE_NOT_AVAILABLE");
        }
        drafts.push(createBillingDraft(current, source, input, context.user.displayName));
      } else if (input.action === "APPROVE") {
        const index = drafts.findIndex((draft) => draft.id === input.draftId);
        if (index < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        drafts[index] = approveBillingDraft(current, input.draftId, input.expectedUpdatedAt, context.user.displayName);
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
        if (drafts[index].updatedAt !== input.expectedUpdatedAt) {
          throw new Error("BILLING_VERSION_CONFLICT");
        }
        if (drafts.slice(index + 1).some((draft) => draft.quoteId === drafts[index].quoteId)) {
          throw new Error("BILLING_DRAFT_HAS_DEPENDENTS");
        }
        drafts.splice(index, 1);
      }
      return { schemaVersion: 1 as const, drafts };
    });
    return noStoreJson({ payload, canWrite: true });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "BILLING_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "BILLING_MUTATION_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}
