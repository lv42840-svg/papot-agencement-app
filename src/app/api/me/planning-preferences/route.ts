import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";

export async function PATCH(requete: Request) {
  const utilisateur = await getCurrentUser();
  if (!utilisateur) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const corps = (await requete.json().catch(() => null)) as {
    planningPotentialCollapsed?: unknown;
  } | null;
  if (typeof corps?.planningPotentialCollapsed !== "boolean") {
    return NextResponse.json({ error: "Préférence invalide." }, { status: 400 });
  }
  const planningPotentialCollapsed = corps.planningPotentialCollapsed;

  await mutateAuthPayload(utilisateur.id, (contenu) => {
    const cible = contenu.users.find(
      (candidat) => candidat.id === utilisateur.id && candidat.isActive,
    );
    if (!cible) throw new Error("AUTH_USER_NOT_FOUND");
    cible.planningPotentialCollapsed = planningPotentialCollapsed;
  });

  return NextResponse.json({ ok: true });
}
