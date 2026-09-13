import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { readAuthPayload } from "@/lib/auth/store";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Identifiants invalides." }, { status: 400 });
  }

  const payload = await readAuthPayload();
  const email = parsed.data.email.trim().toLowerCase();
  const user = payload.users.find(
    (candidate) => candidate.isActive && candidate.email.trim().toLowerCase() === email,
  );

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Adresse e-mail ou mot de passe incorrect." },
      { status: 401 },
    );
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword });
}
