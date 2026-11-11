import { withBusinessTransaction } from "@/lib/server-db/business-transaction";
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
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { convertPlanningProvisionToFirm } from "@/lib/planning/mutations";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
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

export async function POST(requete: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const saisie = launchChantierFromAffairSchema.parse(await requete.json());
    stage = "create-runtime";
    const contexte = await requireModuleRequestContext("chantiers", "WRITE");
    await requireSpecialPermission(contexte.user, "commercial.confirm_launch");
    const commercialRepository = createCommercialRepository();
    const chantiersRepository = createChantiersRepository(contexte);
    const auteur = { userId: contexte.user.id, displayName: contexte.user.displayName };

    stage = "read-affair";
    const commercial = await commercialRepository.load();
    const affair = commercial.cases.find((element) => element.id === saisie.commercialCaseId);
    if (!affair) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");

    stage = "derive-launch-hours";
    const quotes = await createQuotesRepository().load();
    const launchHours = deriveChantierLaunchHours(affair, quotes);

    const planningRepository = createPlanningRepository();
    await Promise.all([chantiersRepository.load(), planningRepository.load()]);
    stage = "apply-and-save-launch";
    const mutation = await withBusinessTransaction(async () => {
      const resultat = await chantiersRepository.mutate((contenu) => {
        const existing = contenu.chantiers.find(
          (site) => site.sourceCommercialCaseId === affair.id,
        );
        if (existing)
          return { payload: contenu, focusChantierId: existing.id, shouldPersist: false };
        return launchChantierFromAffair(
          contenu,
          affair,
          {
            ...saisie,
            be: launchHours.hours.be,
            workshop: launchHours.hours.workshop,
            install: launchHours.hours.install,
          },
          auteur,
        );
      });
      if (!resultat.focusChantierId) throw new Error("CHANTIER_LAUNCH_FOCUS_MISSING");
      await planningRepository.mutate((contenu) =>
        convertPlanningProvisionToFirm(contenu, affair.id, resultat.focusChantierId!),
      );
      return resultat;
    });

    console.info("[PAPOT][Chantiers] launch from affair saved", { ms: Date.now() - startedAt });
    return noStoreJson({
      payload: mutation.payload,
      actor: auteur,
      capabilities: {
        ...chantierCapabilities(auteur),
        canRead: true,
        canModify: true,
        canLaunch: true,
        canArchive: true,
      },
      focusChantierId: mutation.focusChantierId,
      serverNow: new Date().toISOString(),
    });
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "CHANTIER_LAUNCH_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "CHANTIER_LAUNCH_FAILED";
    console.error("[PAPOT][Chantiers] launch failed", { stage, code, ms: Date.now() - startedAt });
    const corps =
      erreur instanceof ChantiersRepositoryError && erreur.details?.lockedBy
        ? { error: code, lockedBy: erreur.details.lockedBy }
        : { error: code };
    return noStoreJson(corps, { status: statusFor(code) });
  }
}
