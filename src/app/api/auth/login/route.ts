import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/pool";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Identifiants invalides." }, { status: 400 });
  }

  const result = await db.query<{
    id: string;
    password_hash: string;
  }>("SELECT id, password_hash FROM app_user WHERE lower(email) = lower($1) AND is_active = true", [
    parsed.data.email,
  ]);
  const user = result.rows[0];

  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return NextResponse.json(
      { error: "Adresse e-mail ou mot de passe incorrect." },
      { status: 401 },
    );
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
