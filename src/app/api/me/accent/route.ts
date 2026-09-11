import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/pool";
import { isAccentKey } from "@/lib/theme/palette";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { accentKey?: string } | null;
  if (!body?.accentKey || !isAccentKey(body.accentKey)) {
    return NextResponse.json({ error: "Couleur non autorisée." }, { status: 400 });
  }
  await db.query("UPDATE app_user SET accent_key = $1, updated_at = now() WHERE id = $2", [
    body.accentKey,
    user.id,
  ]);
  return NextResponse.json({ ok: true });
}
