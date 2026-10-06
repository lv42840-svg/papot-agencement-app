import { NextResponse } from "next/server";
import { z } from "zod";

import { clearAdminResetRequirement } from "@/lib/auth/login-rate-limit";
import {
  consumePasswordSetupToken,
  passwordSetupTokenHash,
} from "@/lib/auth/password-setup";

const schema = z
  .object({
    token: z.string().min(32).max(512),
    password: z.string().min(12).max(512),
    confirmPassword: z.string().min(12).max(512),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Le mot de passe doit contenir au moins 12 caractères.",
      },
      { status: 400 },
    );
  }

  const consumed = await consumePasswordSetupToken({
    tokenHash: passwordSetupTokenHash(parsed.data.token),
    password: parsed.data.password,
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
