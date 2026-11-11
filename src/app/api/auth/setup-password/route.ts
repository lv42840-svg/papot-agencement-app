import { NextResponse } from "next/server";
import { z } from "zod";

import { allowPasswordSetupRequest, clearAdminResetRequirement } from "@/lib/auth/login-rate-limit";
import { consumePasswordSetupToken, passwordSetupTokenHash } from "@/lib/auth/password-setup";

const schema = z
  .object({
    token: z.string().min(32).max(512),
    password: z.string().min(12).max(512),
    confirmPassword: z.string().min(12).max(512),
  })
  .refine((valeur) => valeur.password === valeur.confirmPassword, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });

export async function POST(requete: Request) {
  if (!(await allowPasswordSetupRequest(requete)))
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez dans 15 minutes." },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  const analyse = schema.safeParse(await requete.json().catch(() => null));
  if (!analyse.success) {
    return NextResponse.json(
      {
        error:
          analyse.error.issues[0]?.message ??
          "Le mot de passe doit contenir au moins 12 caractères.",
      },
      { status: 400 },
    );
  }

  const consumed = await consumePasswordSetupToken({
    tokenHash: passwordSetupTokenHash(analyse.data.token),
    password: analyse.data.password,
  });

  if (!consumed) {
    return NextResponse.json(
      { error: "Lien de définition du mot de passe invalide ou expiré." },
      { status: 400 },
    );
  }

  await clearAdminResetRequirement(consumed.username);
  return NextResponse.json({
    ok: true,
    message: "Mot de passe défini. Vous pouvez vous connecter.",
  });
}
