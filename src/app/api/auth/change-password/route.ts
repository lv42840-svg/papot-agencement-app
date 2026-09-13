import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import {
  createSession,
  destroyAllSessionsForUser,
  getCurrentUser,
} from "@/lib/auth/session";
import { db } from "@/lib/db/pool";

const schema = z.object({
  password: z.string().min(12).max(512),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Le nouveau mot de passe doit contenir au moins 12 caractères." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.query(
    `UPDATE app_user
     SET password_hash = $2, must_change_password = false
     WHERE id = $1 AND is_active = true`,
    [user.id, passwordHash],
  );
  await destroyAllSessionsForUser(user.id);
  await createSession(user.id);

  return NextResponse.json({ ok: true });
}
