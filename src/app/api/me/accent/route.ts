import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";
import { isAccentKey } from "@/lib/theme/palette";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { accentKey?: string } | null;
  if (!body?.accentKey || !isAccentKey(body.accentKey)) {
    return NextResponse.json({ error: "Couleur non autorisée." }, { status: 400 });
  }
  await mutateAuthPayload(user.id, (payload) => {
    const target = payload.users.find(
      (candidate) => candidate.id === user.id && candidate.isActive,
    );
    if (!target) throw new Error("AUTH_USER_NOT_FOUND");
    target.accentKey = body.accentKey!;
  });
  return NextResponse.json({ ok: true });
}
