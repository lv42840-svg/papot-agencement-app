import { z } from "zod";
import { requireSpecialPermission, hasSpecialPermission } from "@/lib/auth/permissions";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { createBillingRepository } from "@/lib/billing/repository";
import { issueNativeInvoiceInputSchema } from "@/lib/billing/native-issuance";
import { issueNativeCreditNoteInputSchema } from "@/lib/billing/native-credit-notes";
import {
  TEST_RESET_CONFIRMATION,
  resetBillingTestSandbox,
  simulateBillingTestCredit,
  simulateBillingTestInvoice,
  summarizeBillingTestSandbox,
} from "@/lib/billing/test-sandbox";
import { createCompanyProfileRepository } from "@/lib/company-profile/create-repository";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { CompanyProfile } from "@/lib/company-profile/domain";
import type { ClientRecord } from "@/lib/clients/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SIMULATE_INVOICE"),
      input: issueNativeInvoiceInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("SIMULATE_CREDIT"),
      input: issueNativeCreditNoteInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("RESET_TESTS"),
      confirmation: z.literal(TEST_RESET_CONFIRMATION),
    })
    .strict(),
]);

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function authorizeSandbox() {
  const context = await requireModuleRequestContext("billing", "WRITE");
  await requireSpecialPermission(context.user, "billing.test_sandbox");
  if (process.env.PAPOT_BILLING_TEST_SANDBOX_ENABLED !== "true") {
    throw new Error("BILLING_TEST_SANDBOX_DISABLED");
  }
  return context;
}

function httpStatus(code: string): number {
  return (
    desktopRequestErrorStatus(code) ??
    (code === "BILLING_TEST_SANDBOX_DISABLED"
      ? 403
      : code === "BILLING_TEST_DOCUMENT_NOT_FOUND"
        ? 404
        : code === "BILLING_TEST_BAD_REQUEST"
          ? 400
          : code.startsWith("BILLING_")
            ? 409
            : 500)
  );
}

export async function GET() {
  try {
    const context = await authorizeSandbox();
    const [payload, canReset] = await Promise.all([
      createBillingRepository().load(),
      hasSpecialPermission(context.user.id, "billing.reset_test_sandbox"),
    ]);
    return noStore({
      sandbox: summarizeBillingTestSandbox(payload),
      canReset,
      availableDrafts: payload.drafts
        .filter((draft) => draft.status === "APPROVED")
        .map((draft) => ({
          id: draft.id,
          updatedAt: draft.updatedAt,
          clientName: draft.clientName,
          affairName: draft.affairName,
          label: draft.label,
          totalTtcCents: draft.totalTtcCents,
        })),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_TEST_LOAD_FAILED";
    return noStore({ error: code }, httpStatus(code));
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeSandbox();
    const parsed = testActionSchema.safeParse(await request.json());
    if (!parsed.success) return noStore({ error: "BILLING_TEST_BAD_REQUEST" }, 400);
    const action = parsed.data;
    if (action.action === "RESET_TESTS") {
      // Stronger separate privilege, exact typed confirmation, never a general billing reset.
      await requireSpecialPermission(context.user, "billing.reset_test_sandbox");
    }

    let company: CompanyProfile | undefined;
    let clients: ClientRecord[] | undefined;
    if (action.action === "SIMULATE_INVOICE") {
      const [profile, clientPayload] = await Promise.all([
        createCompanyProfileRepository().load(),
        (await createClientsRepository()).load(),
      ]);
      company = profile;
      clients = clientPayload.clients;
    }

    const payload = await createBillingRepository().mutate((current) => {
      if (action.action === "RESET_TESTS") {
        return resetBillingTestSandbox(current, action.confirmation, context.user.displayName);
      }
      if (action.action === "SIMULATE_CREDIT") {
        return simulateBillingTestCredit(current, action.input, context.user.displayName);
      }
      const draft = current.drafts.find((item) => item.id === action.input.draftId);
      if (!draft) throw new Error("BILLING_DRAFT_NOT_FOUND");
      const client = clients?.find((item) => item.id === draft.clientId);
      if (!company || !client) throw new Error("BILLING_NATIVE_BUYER_PROFILE_INCOMPLETE");
      return simulateBillingTestInvoice(
        current,
        action.input,
        company,
        client,
        context.user.displayName,
      );
    });
    return noStore({
      sandbox: summarizeBillingTestSandbox(payload),
      reset: action.action === "RESET_TESTS",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_TEST_MUTATION_FAILED";
    return noStore({ error: code }, httpStatus(code));
  }
}
