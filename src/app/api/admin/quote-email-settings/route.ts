import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { createQuoteEmailSettingsRepository } from "@/lib/quote-email-settings/create-repository";
import { quoteEmailSettingsSchema } from "@/lib/quote-email-settings/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  try {
    await requirePermissionAdministrator();
    const settings = await createQuoteEmailSettingsRepository().load();
    return noStoreJson({ settings });
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_EMAIL_SETTINGS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermissionAdministrator();
    const settings = quoteEmailSettingsSchema.parse(await request.json().catch(() => null));
    const saved = await createQuoteEmailSettingsRepository().replace(settings);
    return noStoreJson({ settings: saved });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "QUOTE_EMAIL_SETTINGS_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTE_EMAIL_SETTINGS_SAVE_FAILED";
    const status =
      code === "QUOTE_EMAIL_SETTINGS_REQUEST_INVALID" ? 400 : userAdminErrorStatus(code);
    return noStoreJson({ error: code }, { status });
  }
}
