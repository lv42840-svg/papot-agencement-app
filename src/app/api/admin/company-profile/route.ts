import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { createCompanyProfileRepository } from "@/lib/company-profile/create-repository";
import { companyProfileSchema } from "@/lib/company-profile/domain";

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
    const profile = await createCompanyProfileRepository().load();
    return noStoreJson({ profile });
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMPANY_PROFILE_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermissionAdministrator();
    const profile = companyProfileSchema.parse(await request.json().catch(() => null));
    const saved = await createCompanyProfileRepository().replace(profile);
    return noStoreJson({ profile: saved });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "COMPANY_PROFILE_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "COMPANY_PROFILE_SAVE_FAILED";
    const status = code === "COMPANY_PROFILE_REQUEST_INVALID" ? 400 : userAdminErrorStatus(code);
    return noStoreJson({ error: code }, { status });
  }
}
