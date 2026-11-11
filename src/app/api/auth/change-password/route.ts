import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";

const schema = z.object({
  password: z.string().min(12).max(512),
});

export async function POST(requete: Request) {
  const utilisateur = await getCurrentUser();
  if (!utilisateur) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const analyse = schema.safeParse(await requete.json().catch(() => null));
  if (!analyse.success) {
    return NextResponse.json(
      { error: "Le nouveau mot de passe doit contenir au moins 12 caractères." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(analyse.data.password);
  await mutateAuthPayload(utilisateur.id, (contenu) => {
    const cible = contenu.users.find(
      (candidat) => candidat.id === utilisateur.id && candidat.isActive,
    );
    if (!cible) throw new Error("AUTH_USER_NOT_FOUND");
    cible.passwordHash = passwordHash;
    cible.mustChangePassword = false;
    contenu.sessions = contenu.sessions.filter((session) => session.userId !== utilisateur.id);
  });
  await createSession(utilisateur.id);

  return NextResponse.json({ ok: true });
}
