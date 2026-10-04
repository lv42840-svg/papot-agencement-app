import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";
import { isAccentKey } from "@/lib/theme/palette";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    accentKey?: string;
    expectedAccentKey?: string;
  } | null;
  if (!body?.accentKey || !isAccentKey(body.accentKey)) {
    return NextResponse.json({ error: "Couleur non autorisée." }, { status: 400 });
  }
  if (!body.expectedAccentKey || !isAccentKey(body.expectedAccentKey)) {
    return NextResponse.json({ error: "PREFERENCE_VERSION_REQUIRED" }, { status: 428 });
  }
  try {
    await mutateAuthPayload(user.id, (payload) => {
    const target = payload.users.find(
      (candidate) => candidate.id === user.id && candidate.isActive,
    );
      if (!target) throw new Error("AUTH_USER_NOT_FOUND");
      if (target.accentKey !== body.expectedAccentKey) {
        throw new Error("PREFERENCE_VERSION_CONFLICT");
      }
      target.accentKey = body.accentKey!;
    });
    return NextResponse.json({ ok: true, accentKey: body.accentKey });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PREFERENCE_UPDATE_FAILED";
    if (code === "PREFERENCE_VERSION_CONFLICT") {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    throw error;
  }
}
