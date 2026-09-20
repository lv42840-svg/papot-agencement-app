import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import {
  launchChantierFromAffair,
  launchChantierFromAffairSchema,
} from "@/lib/chantiers/launch-from-affair";
import { deriveChantierLaunchHours } from "@/lib/chantiers/launch-hours";
import { chantierCapabilities } from "@/lib/chantiers/mutations";
import { ChantiersRepositoryError } from "@/lib/chantiers/repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "CHANTIERS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (code.includes("ALREADY") || code.includes("CONFLICT")) return 409;
  return 400;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const input = launchChantierFromAffairSchema.parse(await request.json());
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("chantiers", "WRITE");
    await requireSpecialPermission(context.user, "commercial.confirm_launch");
    const commercialRepository = await createCommercialRepository(context);
    const chantiersRepository = createChantiersRepository(context);
    const actor = { userId: context.owner.userId, displayName: context.owner.displayName };

    stage = "read-affair";
    const commercial = await commercialRepository.load();
    const affair = commercial.cases.find((item) => item.id === input.commercialCaseId);
    if (!affair) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");

    stage = "derive-launch-hours";
    const quotes = await createQuotesRepository().load();
    const launchHours = deriveChantierLaunchHours(affair, quotes);

    stage = "apply-and-save-launch";
    const mutation = await chantiersRepository.mutate((payload) =>
      launchChantierFromAffair(
        payload,
        affair,
        {
          ...input,
          be: launchHours.hours.be,
          workshop: launchHours.hours.workshop,
          install: launchHours.hours.install,
        },
        actor,
      ),
    );

    console.info("[PAPOT][Chantiers] launch from affair saved", { ms: Date.now() - startedAt });
    return noStoreJson({
      payload: mutation.payload,
      actor,
      capabilities: {
        ...chantierCapabilities(actor),
        canRead: true,
        canModify: true,
        canLaunch: true,
        canArchive: true,
      },
      focusChantierId: mutation.focusChantierId,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "CHANTIER_LAUNCH_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "CHANTIER_LAUNCH_FAILED";
    console.error("[PAPOT][Chantiers] launch failed", { stage, code, ms: Date.now() - startedAt });
    const body =
      error instanceof ChantiersRepositoryError && error.details?.lockedBy
        ? { error: code, lockedBy: error.details.lockedBy }
        : { error: code };
    return noStoreJson(body, { status: statusFor(code) });
  }
}
