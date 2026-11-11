import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { createQuoteEmailSettingsRepository } from "@/lib/quote-email-settings/create-repository";
import { quoteEmailSettingsSchema } from "@/lib/quote-email-settings/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

export async function GET() {
  try {
    await requirePermissionAdministrator();
    const reglages = await createQuoteEmailSettingsRepository().load();
    return noStoreJson({ settings: reglages });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTE_EMAIL_SETTINGS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}

export async function POST(requete: Request) {
  try {
    await requirePermissionAdministrator();
    const reglages = quoteEmailSettingsSchema.parse(await requete.json().catch(() => null));
    const saved = await createQuoteEmailSettingsRepository().replace(reglages);
    return noStoreJson({ settings: saved });
  } catch (erreur) {
    const code =
      erreur instanceof z.ZodError
        ? "QUOTE_EMAIL_SETTINGS_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "QUOTE_EMAIL_SETTINGS_SAVE_FAILED";
    const statut =
      code === "QUOTE_EMAIL_SETTINGS_REQUEST_INVALID" ? 400 : userAdminErrorStatus(code);
    return noStoreJson({ error: code }, { status: statut });
  }
}
