import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { createCompanyProfileRepository } from "@/lib/company-profile/create-repository";
import { companyProfileSchema } from "@/lib/company-profile/domain";

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
    const profile = await createCompanyProfileRepository().load();
    return noStoreJson({ profile });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "COMPANY_PROFILE_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}

export async function POST(requete: Request) {
  try {
    await requirePermissionAdministrator();
    const profile = companyProfileSchema.parse(await requete.json().catch(() => null));
    const saved = await createCompanyProfileRepository().replace(profile);
    return noStoreJson({ profile: saved });
  } catch (erreur) {
    const code =
      erreur instanceof z.ZodError
        ? "COMPANY_PROFILE_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "COMPANY_PROFILE_SAVE_FAILED";
    const statut = code === "COMPANY_PROFILE_REQUEST_INVALID" ? 400 : userAdminErrorStatus(code);
    return noStoreJson({ error: code }, { status: statut });
  }
}
