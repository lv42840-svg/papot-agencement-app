import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";
import { isAccentKey } from "@/lib/theme/palette";

export async function PATCH(requete: Request) {
  const utilisateur = await getCurrentUser();
  if (!utilisateur) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const corps = (await requete.json().catch(() => null)) as { accentKey?: string } | null;
  if (!corps?.accentKey || !isAccentKey(corps.accentKey)) {
    return NextResponse.json({ error: "Couleur non autorisée." }, { status: 400 });
  }
  await mutateAuthPayload(utilisateur.id, (contenu) => {
    const cible = contenu.users.find(
      (candidat) => candidat.id === utilisateur.id && candidat.isActive,
    );
    if (!cible) throw new Error("AUTH_USER_NOT_FOUND");
    cible.accentKey = corps.accentKey!;
  });
  return NextResponse.json({ ok: true });
}
