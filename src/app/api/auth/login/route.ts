import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLogin } from "@/lib/auth/login-rate-limit";
import { createSession, setSessionCookie } from "@/lib/auth/session";

const schema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Identifiants invalides." }, { status: 400 });
  }

  const result = await authenticateLogin({
    username: parsed.data.username,
    password: parsed.data.password,
    request,
  });

  if (result.state === "authenticated") {
    if (result.token && result.expiresAt) {
      await setSessionCookie(result.token, result.expiresAt);
    } else {
      await createSession(result.userId);
    }
    return NextResponse.json({ ok: true });
  }

  if (result.state === "admin_reset_required") {
    return NextResponse.json(
      { error: "Compte verrouillé. Demandez à un administrateur de réinitialiser votre accès." },
      { status: 423 },
    );
  }

  if (result.state === "temporary") {
    const response = NextResponse.json(
      { error: "Trop de tentatives. Réessayez dans quelques minutes." },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(result.retryAfter));
    return response;
  }

  return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
}
