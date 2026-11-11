import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLogin } from "@/lib/auth/login-rate-limit";
import { createSession, setSessionCookie } from "@/lib/auth/session";

const schema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(512),
});

export async function POST(requete: Request) {
  const analyse = schema.safeParse(await requete.json().catch(() => null));
  if (!analyse.success) {
    return NextResponse.json({ error: "Identifiants invalides." }, { status: 400 });
  }

  const resultat = await authenticateLogin({
    username: analyse.data.username,
    password: analyse.data.password,
    request: requete,
  });

  if (resultat.state === "authenticated") {
    if (resultat.token && resultat.expiresAt) {
      await setSessionCookie(resultat.token, resultat.expiresAt);
    } else {
      await createSession(resultat.userId);
    }
    return NextResponse.json({ ok: true });
  }

  if (resultat.state === "admin_reset_required") {
    return NextResponse.json(
      { error: "Compte verrouillé. Demandez à un administrateur de réinitialiser votre accès." },
      { status: 423 },
    );
  }

  if (resultat.state === "temporary") {
    const reponse = NextResponse.json(
      { error: "Trop de tentatives. Réessayez dans quelques minutes." },
      { status: 429 },
    );
    reponse.headers.set("Retry-After", String(resultat.retryAfter));
    return reponse;
  }

  return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
}
